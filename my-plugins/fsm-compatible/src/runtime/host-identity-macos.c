#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#ifdef __APPLE__
#include <libproc.h>
#include <sys/proc_info.h>
#endif

int main(void) {
#ifdef __APPLE__
    const pid_t parent = getppid();
    struct proc_bsdinfo info;
    memset(&info, 0, sizeof(info));
    if (parent <= 1 || proc_pidinfo(parent, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) return 1;
    if (info.pbi_pid != (uint32_t)parent || info.pbi_start_tvusec >= 1000000) return 1;
    if (info.pbi_start_tvsec > (UINT64_MAX - info.pbi_start_tvusec) / 1000000) return 1;
    const uint64_t start = info.pbi_start_tvsec * 1000000 + info.pbi_start_tvusec;
    if (start == 0) return 1;
    printf("{\"pid\":%ld,\"startId\":\"%" PRIu64 "\"}\n", (long)parent, start);
    return 0;
#else
    return 1;
#endif
}
