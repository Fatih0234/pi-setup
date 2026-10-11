/**
 * Pi split-fork extension
 *
 * /split-fork [optional prompt]
 *
 * Forks the active session branch into a fresh Pi process launched in a
 * separate terminal, so you can continue exploring an idea without losing
 * the current session.
 *
 * Backends (PI_SPLIT_FORK_BACKEND=auto|tmux|wt|alacritty):
 *   - tmux:       inside tmux you pick where the fork lands: right-hand pane
 *                 (vertical split), lower pane (horizontal split), or a new
 *                 window in the same tmux session
 *   - wt:         fresh Windows Terminal window (default); set
 *                 PI_SPLIT_FORK_WT_TARGET=tab for a tab in the current
 *                 window instead
 *   - alacritty:  new Alacritty window (IPC first, detached process fallback)
 *   - auto:       tmux (with the target picker) when inside tmux, else
 *                 Windows Terminal on WSL, else Alacritty if installed
 *
 * The Windows Terminal backend runs the fork under `script(1)` because Pi
 * spawned via wt.exe -> wsl.exe sees stdin as a tty but stdout as a pipe,
 * which makes Pi pick non-interactive mode and exit after the first prompt.
 * script(1) allocates a real pty for both, keeping the fork interactive.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Backend = "auto" | "tmux" | "wt" | "alacritty";

/** Where a tmux fork should land. */
type TmuxTarget = "split-right" | "split-below" | "new-window";

const FORK_TITLE = "Pi fork";

const USAGE = `/split-fork [optional prompt]

Forks the current session branch into a fresh Pi in:
 - a tmux pane/window of your choosing (tmux backend)
 - a fresh Windows Terminal window (default), or tab with
   PI_SPLIT_FORK_WT_TARGET=tab
 - an Alacritty window

Backend: PI_SPLIT_FORK_BACKEND=auto|tmux|wt|alacritty (default auto)`;

function normalizeBackend(value: string): Backend | undefined {
	switch (value) {
		case "tmux":
			return "tmux";
		case "wt":
		case "winterminal":
		case "windows-terminal":
		case "windowsterminal":
			return "wt";
		case "alacritty":
			return "alacritty";
		default:
			return undefined;
	}
}

function getBackend(): Backend {
	const value = process.env.PI_SPLIT_FORK_BACKEND?.toLowerCase().trim();
	return normalizeBackend(value ?? "") ?? "auto";
}

/**
 * Where the Windows Terminal fork should land.
 * PI_SPLIT_FORK_WT_TARGET=tab prefers a tab in the current window;
 * anything else (default) opens a fresh window.
 */
type WtTarget = "window" | "tab";

function getWtTarget(): WtTarget {
	const value = process.env.PI_SPLIT_FORK_WT_TARGET?.toLowerCase().trim();
	return value === "tab" ? "tab" : "window";
}

/**
 * Filesystem-only check whether an executable is on PATH. Never spawns the
 * binary: spawning wt.exe to probe availability pops Windows Terminal's
 * modal "Help" dialog when stdout is not attached to a console (spawnSync
 * uses null handles), so probing must stay process-free. Alacritty is
 * checked the same way for consistency.
 */
function executableOnPath(name: string): boolean {
	const exe = name.toLowerCase().endsWith(".exe")
		? name
		: `${name}.exe`;

	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir.startsWith("/mnt/")) {
			continue;
		}

		try {
			if (existsSync(path.join(dir, exe))) {
				return true;
			}
		} catch {
			// Skip unreadable PATH entries.
		}
	}

	return false;
}

/**
 * Reuse the currently running Pi executable where possible.
 *
 * This supports:
 * - npm/global Node installations
 * - Bun installations
 * - standalone Pi binaries
 */
function getPiInvocationParts(): string[] {
	const currentScript = process.argv[1];

	// Bun's standalone runtime exposes its embedded entry script as a
	// virtual "/$bunfs/..." path. existsSync() reports it as present, but it
	// is not a real file a child process could open: passing it to the fork
	// would leak a spurious "/$bunfs/root/pi" message into the new session.
	if (
		currentScript &&
		!currentScript.startsWith("/$bunfs/") &&
		existsSync(currentScript)
	) {
		return [process.execPath, currentScript];
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);

	if (!isGenericRuntime) {
		return [process.execPath];
	}

	return ["pi"];
}

function buildPiCommand(
	sessionFile: string | undefined,
	prompt: string,
): string[] {
	const command = [...getPiInvocationParts()];

	if (sessionFile) {
		command.push("--session", sessionFile);
	}

	if (prompt.length > 0) {
		// This pi build has no `--` message separator; messages are
		// positional. Guard against prompts that look like flags (`-`) or
		// `@file` references, which pi would otherwise try to parse.
		command.push(/^[-@]/.test(prompt) ? ` ${prompt}` : prompt);
	}

	return command;
}

/**
 * Copy only the active branch, rather than the entire session tree.
 */
async function createForkedSession(
	ctx: ExtensionCommandContext,
): Promise<string | undefined> {
	const sessionFile = ctx.sessionManager.getSessionFile();

	if (!sessionFile) {
		return undefined;
	}

	const sessionDir = path.dirname(sessionFile);
	const branchEntries = ctx.sessionManager.getBranch();
	const currentHeader = ctx.sessionManager.getHeader();

	const timestamp = new Date().toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const newSessionId = randomUUID();

	const newSessionFile = path.join(
		sessionDir,
		`${fileTimestamp}_${newSessionId}.jsonl`,
	);

	const newHeader = {
		type: "session",
		version: currentHeader?.version ?? 3,
		id: newSessionId,
		timestamp,
		cwd: currentHeader?.cwd ?? ctx.cwd,
		parentSession: sessionFile,
	};

	const lines =
		[
			JSON.stringify(newHeader),
			...branchEntries.map((entry) => JSON.stringify(entry)),
		].join("\n") + "\n";

	await fs.mkdir(sessionDir, { recursive: true });
	await fs.writeFile(newSessionFile, lines, "utf8");

	return newSessionFile;
}

function resultReason(result: {
	stderr?: string;
	stdout?: string;
	code: number;
}): string {
	return (
		result.stderr?.trim() ||
		result.stdout?.trim() ||
		`command exited with code ${result.code}`
	);
}

/**
 * Create a tmux pane or window for the fork, targeting the exact pane
 * containing this Pi process.
 *
 * Passing the Pi executable and its arguments separately avoids shell
 * quoting problems with spaces, apostrophes, and prompt text.
 */
async function launchInTmux(
	pi: ExtensionAPI,
	cwd: string,
	command: string[],
	target: TmuxTarget = "split-right",
): Promise<string> {
	const targetPane = process.env.TMUX_PANE;

	if (!process.env.TMUX || !targetPane) {
		throw new Error(
			"Pi is not running inside tmux. Start tmux first or use the wt/alacritty backend.",
		);
	}

	const tmuxArgs: string[] =
		target === "new-window"
			? ["new-window", "-c", cwd, "-n", FORK_TITLE, ...command]
			: [
					"split-window",
					target === "split-below" ? "-v" : "-h",
					"-p",
					"50",
					"-c",
					cwd,
					"-t",
					targetPane,
					...command,
				];

	const result = await pi.exec("tmux", tmuxArgs);

	if (result.code !== 0) {
		throw new Error(`tmux command failed: ${resultReason(result)}`);
	}

	switch (target) {
		case "split-below":
			return "a lower tmux pane";
		case "new-window":
			return "a new tmux window";
		default:
			return "a right-hand tmux pane";
	}
}

function spawnDetached(
	executable: string,
	args: string[],
	cwd: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd,
			env: process.env,
			detached: true,
			stdio: "ignore",
		});

		child.once("error", reject);

		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

/**
 * Quote a string for use as a single bash argument.
 */
function bashQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Whether a Windows Terminal process is already running on the Windows
 * side. Only matters for tab mode: a tab can attach to an existing window,
 * but when no Windows Terminal is running a fresh window is started.
 */
function windowsTerminalIsRunning(): boolean {
	try {
		const result = spawnSync(
			"tasklist.exe",
			["/FI", "IMAGENAME eq WindowsTerminal.exe", "/NH"],
			{ encoding: "utf8", windowsHide: true, timeout: 15000 },
		);

		return (
			result.error === undefined &&
			result.status === 0 &&
			/WindowsTerminal\.exe/i.test(result.stdout ?? "")
		);
	} catch {
		return false;
	}
}

/**
 * Launch the fork in Windows Terminal. Default: a fresh window. With
 * PI_SPLIT_FORK_WT_TARGET=tab and Windows Terminal already running, it
 * opens as a tab in the current window (-w 0) instead.
 *
 * Windows Terminal re-parses its command line and mangles nested quotes, so
 * the Pi invocation is written into a small self-deleting script in /tmp
 * and only the space-free script path travels through wt.exe -> wsl.exe ->
 * bash. The script removes itself when the forked Pi exits.
 */
async function launchInWindowsTerminal(
	cwd: string,
	command: string[],
): Promise<string> {
	const distro = process.env.WSL_DISTRO_NAME;

	if (!distro) {
		throw new Error(
			"The Windows Terminal backend requires WSL (WSL_DISTRO_NAME is unset).",
		);
	}

	const scriptPath = path.join(
		os.tmpdir(),
		`pi-split-fork-${randomUUID()}.sh`,
	);

	const piCommand = command.map(bashQuote).join(" ");

	const script = [
		"#!/usr/bin/env bash",
		'trap \'rm -f -- "$0"\' EXIT',
		`cd ${bashQuote(cwd)} || exit 1`,
		`script -qec ${bashQuote(piCommand)} /dev/null`,
	].join("\n");

	await fs.writeFile(scriptPath, `${script}\n`, "utf8");

	try {
		const useTab = getWtTarget() === "tab" && windowsTerminalIsRunning();

		const wtArgs = useTab
			? ["-w", "0", "new-tab", "--title", FORK_TITLE, "--"]
			: ["new-tab", "--title", FORK_TITLE, "--"];

		await spawnDetached(
			"wt.exe",
			[
				...wtArgs,
				"wsl.exe",
				"-d",
				distro,
				"--",
				"bash",
				scriptPath,
			],
			cwd,
		);

		return useTab
			? "a new tab in the current Windows Terminal window"
			: "a new Windows Terminal window";
	} catch (error) {
		await fs.unlink(scriptPath).catch(() => {});
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Windows Terminal launch failed: ${reason}`);
	}
}

/**
 * Prefer Alacritty IPC so the window belongs to the current Alacritty
 * process. Fall back to launching another Alacritty process.
 */
async function launchInAlacritty(
	pi: ExtensionAPI,
	cwd: string,
	command: string[],
): Promise<string> {
	let ipcFailure: string | undefined;

	if (process.env.ALACRITTY_SOCKET) {
		try {
			const result = await pi.exec("alacritty", [
				"msg",
				"create-window",
				"--working-directory",
				cwd,
				"-T",
				FORK_TITLE,
				"-e",
				...command,
			]);

			if (result.code === 0) {
				return "a new Alacritty window";
			}

			ipcFailure = resultReason(result);
		} catch (error) {
			ipcFailure =
				error instanceof Error ? error.message : String(error);
		}
	}

	try {
		await spawnDetached(
			"alacritty",
			[
				"--working-directory",
				cwd,
				"-T",
				FORK_TITLE,
				"-e",
				...command,
			],
			cwd,
		);
	} catch (error) {
		const fallbackFailure =
			error instanceof Error ? error.message : String(error);

		const details = ipcFailure
			? `IPC failed: ${ipcFailure}; process launch failed: ${fallbackFailure}`
			: fallbackFailure;

		throw new Error(`Alacritty launch failed: ${details}`);
	}

	return "a new Alacritty process";
}

const TARGETS: ReadonlyArray<{ label: string; value: TmuxTarget }> = [
	{
		label: "Split vertically — pane on the right (side-by-side)",
		value: "split-right",
	},
	{
		label: "Split horizontally — pane below (stacked)",
		value: "split-below",
	},
	{
		label: "New window (tab) in this tmux session",
		value: "new-window",
	},
];

/**
 * Ask the user where the fork should land when tmux is in play.
 * Returns undefined when the user cancels the picker.
 */
async function pickTmuxTarget(
	ctx: ExtensionCommandContext,
): Promise<TmuxTarget | undefined> {
	if (!ctx.hasUI) {
		return "split-right";
	}

	const choice = await ctx.ui.select(
		"Fork into:",
		TARGETS.map((target) => target.label),
	);

	if (choice === undefined) {
		return undefined;
	}

	return (
		TARGETS.find((target) => target.label === choice)?.value ??
		"split-right"
	);
}

async function launchFork(
	pi: ExtensionAPI,
	cwd: string,
	command: string[],
	tmuxTarget: TmuxTarget = "split-right",
): Promise<string> {
	const backend = getBackend();

	if (backend === "tmux") {
		return launchInTmux(pi, cwd, command, tmuxTarget);
	}

	if (backend === "wt") {
		return launchInWindowsTerminal(cwd, command);
	}

	if (backend === "alacritty") {
		return launchInAlacritty(pi, cwd, command);
	}

	// Automatic mode: use tmux when this Pi process is inside tmux.
	if (process.env.TMUX && process.env.TMUX_PANE) {
		try {
			return await launchInTmux(pi, cwd, command, tmuxTarget);
		} catch {
			// A pane can fail to split when it is too small, for example.
			// In automatic mode, fall back to a Windows Terminal window.
		}
	}

		// Default on WSL: a Windows Terminal window (or tab when
		// PI_SPLIT_FORK_WT_TARGET=tab is set). Only considered when this is
		// actually WSL, so plain Linux machines fall through to Alacritty.
		if (process.env.WSL_DISTRO_NAME && executableOnPath("wt.exe")) {
			return launchInWindowsTerminal(cwd, command);
		}

	// Last resort for non-WSL Linux setups.
	if (executableOnPath("alacritty")) {
		return launchInAlacritty(pi, cwd, command);
	}

	throw new Error(
		"No terminal backend available. Run Pi inside tmux, install Windows Terminal (WSL), or set PI_SPLIT_FORK_BACKEND=alacritty.",
	);
}

export default function splitForkExtension(pi: ExtensionAPI): void {
	pi.registerCommand("split-fork", {
		description:
			"Fork the active session branch into a tmux pane/window (picker) or a new Windows Terminal window. Usage: /split-fork [optional prompt]",

		handler: async (args, ctx) => {
			if (args.trim() === "--help" || args.trim() === "-h") {
				ctx.ui.notify(USAGE, "info");
				return;
			}

			if (process.platform !== "linux") {
				ctx.ui.notify(
					"/split-fork is intended for Linux (WSL counts).",
					"warning",
				);
				return;
			}

			const backend = getBackend();
			const isInTmux = Boolean(
				process.env.TMUX && process.env.TMUX_PANE,
			);
			const maySplitInTmux =
				backend === "tmux" || (backend === "auto" && isInTmux);

			// Inside tmux, let the user pick where the fork lands. Outside
			// tmux there is no split concept: always spawn a new window.
			let tmuxTarget: TmuxTarget | undefined;

			if (maySplitInTmux) {
				tmuxTarget = await pickTmuxTarget(ctx);

				if (tmuxTarget === undefined) {
					ctx.ui.notify("Fork cancelled.", "info");
					return;
				}
			}

			const wasBusy = !ctx.isIdle();
			const prompt = args.trim();

			let forkedSessionFile: string | undefined;

			try {
				forkedSessionFile = await createForkedSession(ctx);

				const command = buildPiCommand(
					forkedSessionFile,
					prompt,
				);

				const destination = await launchFork(
					pi,
					ctx.cwd,
					command,
					tmuxTarget,
				);

				if (forkedSessionFile) {
					const fileName = path.basename(forkedSessionFile);
					const promptSuffix = prompt
						? " and submitted the prompt"
						: "";

					ctx.ui.notify(
						`Forked ${fileName} into ${destination}${promptSuffix}.`,
						"info",
					);

					if (wasBusy) {
						ctx.ui.notify(
							"Forked from the committed state; the in-flight turn continues in the original session.",
							"info",
						);
					}
				} else {
					ctx.ui.notify(
						`Opened ${destination}, but the current session was not persisted, so there was no history to fork.`,
						"warning",
					);
				}
			} catch (error) {
				const reason =
					error instanceof Error ? error.message : String(error);

				ctx.ui.notify(
					`Failed to launch session fork: ${reason}`,
					"error",
				);

				if (forkedSessionFile) {
					ctx.ui.notify(
						`The forked session file was still created: ${forkedSessionFile}`,
						"info",
					);
				}
			}
		},
	});
}
