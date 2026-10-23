#!/bin/bash
record="$PLOT_RUN/hooks/$$"
/bin/cat > "$record.input.json"
printf '%s\n' "$@" > "$record.argv"
"$PLOT_REAL_HOOK" "$@" < "$record.input.json" > "$record.stdout" 2> "$record.stderr"
status=$?
printf '%s\n' "$status" > "$record.exit"
/bin/cat "$record.stdout"
/bin/cat "$record.stderr" >&2
exit "$status"
