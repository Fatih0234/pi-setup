/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, WezTerm, rxvt-unicode
 * - OSC 9: iTerm2
 * - OSC 99: Kitty
 * - tmux passthrough wrapper for OSC notifications
 * - Windows toast: Windows Terminal (WSL)
 * - Optional sound hook via PI_NOTIFY_SOUND_CMD
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

function writeToTty(sequence: string): void {
    // Bypass any TUI renderer that captures process.stdout. In WSL, /dev/tty
    // resolves to the controlling PTY (e.g., WezTerm's), so OSC escape
    // sequences reach the terminal emulator and surface as native OS
    // notifications. Falls back to stdout for non-TTY contexts (print mode).
    try {
        const fs = require("node:fs");
        const fd = fs.openSync("/dev/tty", "w");
        try {
            fs.writeSync(fd, sequence);
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        process.stdout.write(sequence);
    }
}

function sanitize(s: string): string {
    // OSC payloads can't contain ESC or the protocol's field separator.
    // Project names and cwd paths are normally clean, but guard against
    // anything that could break out of the escape sequence.
    return s.replace(/[\x1b;\x07]/g, "");
}

function windowsToastScript(title: string, body: string): string {
    const type = "Windows.UI.Notifications";
    const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
    const template = `[${type}.ToastTemplateType]::ToastText01`;
    const toast = `[${type}.ToastNotification]::new($xml)`;
    return [
        `${mgr} > $null`,
        `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
        `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
        `[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
    ].join("; ");
}

function wrapForTmux(sequence: string): string {
    if (!process.env.TMUX) return sequence;

    // tmux passthrough: wrap in DCS and escape inner ESC bytes.
    const escaped = sequence.split("\x1b").join("\x1b\x1b");
    return `\x1bPtmux;${escaped}\x1b\\`;
}

function notifyOSC777(title: string, body: string): void {
    const sequence = `\x1b]777;notify;${sanitize(title)};${sanitize(body)}\x07`;
    writeToTty(wrapForTmux(sequence));
}

function notifyOSC9(message: string): void {
    const sequence = `\x1b]9;${sanitize(message)}\x07`;
    writeToTty(wrapForTmux(sequence));
}

function notifyOSC99(title: string, body: string): void {
    // Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
    const titleSequence = `\x1b]99;i=1:d=0;${sanitize(title)}\x1b\\`;
    const bodySequence = `\x1b]99;i=1:p=body;${sanitize(body)}\x1b\\`;
    writeToTty(wrapForTmux(titleSequence));
    writeToTty(wrapForTmux(bodySequence));
}

function notifyWindows(title: string, body: string): void {
    const { execFile } = require("node:child_process");
    execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
}

function runSoundHook(): void {
    const command = process.env.PI_NOTIFY_SOUND_CMD?.trim();
    if (!command) return;

    try {
        const { spawn } = require("node:child_process");
        const child = spawn(command, {
            shell: true,
            detached: true,
            stdio: "ignore",
        });
        child.unref();
    } catch {
        // Ignore hook errors to avoid breaking notifications
    }
}

function notify(title: string, body: string): void {
    const isIterm2 = process.env.TERM_PROGRAM === "iTerm.app" || Boolean(process.env.ITERM_SESSION_ID);

    if (process.env.WT_SESSION) {
        notifyWindows(title, body);
    } else if (process.env.KITTY_WINDOW_ID) {
        notifyOSC99(title, body);
    } else if (isIterm2) {
        notifyOSC9(`${title}: ${body}`);
    } else {
        notifyOSC777(title, body);
    }

    runSoundHook();
}

export default function (pi: ExtensionAPI) {
    pi.on("agent_end", async (_event, ctx) => {
        // Skip headless runs (e.g., subagents spawned in print mode) so only
        // the interactive main session triggers a notification.
        if (process.env.PI_NOTIFY_DISABLE === "1") return;
        if (!ctx.hasUI) return;

        // Use the project directory name as the title so multiple pi sessions
        // on different desktops are distinguishable. Body includes the full
        // path so the user knows exactly which session finished.
        const project = sanitize(basename(ctx.cwd) || "pi");
        const body = sanitize(`Ready for input · ${ctx.cwd}`);
        notify(project, body);
    });
}
