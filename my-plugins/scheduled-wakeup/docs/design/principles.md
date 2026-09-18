# Scheduled Wakeup Principles

## Core intent

- Pursue: a small Pi extension that can schedule prompts to run later or repeatedly while Pi is running.
- Protect: Pi session stability, clean shutdown/reload behavior, and predictable prompt delivery when the agent is busy.
- Do not accept: leaked timers that hang `pi -p`, hidden global state surviving reloads, or a daemon that pretends to wake Pi when no Pi process is running.

## Assumptions

- Pi extensions can inject turns with `pi.sendUserMessage()`.
- Pi has lifecycle hooks for `session_start` and `session_shutdown` but no general cron API.
- Timers inside an extension only fire while the Pi process is alive.
- Runtime schedule state may be stored under the current working directory's `.pi/` data area.

## Experience notes

- Existing local plugin conventions require every long-lived timer to use `.unref?.()` and be cleared on shutdown.
- Existing external loop-style plugins appear to be mostly in-memory; persistence across reload/process restart is the main practical improvement to add.
