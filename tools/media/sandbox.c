#define _GNU_SOURCE
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <linux/filter.h>
#include <linux/audit.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <stddef.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void die(const char *s){perror(s);exit(125);}
static void allow(int fd,const char *path,unsigned long access){int p=open(path,O_PATH|O_CLOEXEC);if(p<0)die(path);struct landlock_path_beneath_attr rule={.allowed_access=access,.parent_fd=p};if(syscall(SYS_landlock_add_rule,fd,LANDLOCK_RULE_PATH_BENEATH,&rule,0))die("landlock rule");close(p);}
#define DENY(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,n,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM)
int main(int argc,char **argv){
 if(argc<3)return 125;
 if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))die("no_new_privs");
 unsigned long read=LANDLOCK_ACCESS_FS_EXECUTE|LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_READ_DIR;
 unsigned long write=LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_REMOVE_DIR|LANDLOCK_ACCESS_FS_REMOVE_FILE|LANDLOCK_ACCESS_FS_MAKE_DIR|LANDLOCK_ACCESS_FS_MAKE_REG;
 struct landlock_ruleset_attr rules={.handled_access_fs=read|write|LANDLOCK_ACCESS_FS_MAKE_CHAR|LANDLOCK_ACCESS_FS_MAKE_BLOCK|LANDLOCK_ACCESS_FS_MAKE_FIFO|LANDLOCK_ACCESS_FS_MAKE_SOCK|LANDLOCK_ACCESS_FS_MAKE_SYM};
 int fd=syscall(SYS_landlock_create_ruleset,&rules,sizeof(rules),0);if(fd<0)die("landlock required");
 allow(fd,"/usr",read);allow(fd,"/lib",read);if(access("/lib64",F_OK)==0)allow(fd,"/lib64",read);
 allow(fd,argv[1],read|write);
 allow(fd,"/dev/null",LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE);
 if(access("/etc/fonts",F_OK)==0)allow(fd,"/etc/fonts",LANDLOCK_ACCESS_FS_READ_DIR|LANDLOCK_ACCESS_FS_READ_FILE);
 if(syscall(SYS_landlock_restrict_self,fd,0))die("landlock restrict");close(fd);
#if defined(__aarch64__)
 #define NATIVE_ARCH AUDIT_ARCH_AARCH64
#elif defined(__x86_64__)
 #define NATIVE_ARCH AUDIT_ARCH_X86_64
#else
 #error Unsupported media sandbox architecture
#endif
 struct sock_filter filter[]={BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,NATIVE_ARCH,1,0),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),BPF_JUMP(BPF_JMP|BPF_JGE|BPF_K,0x40000000,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
 DENY(SYS_socket),DENY(SYS_connect),DENY(SYS_bind),DENY(SYS_listen),DENY(SYS_accept),DENY(SYS_accept4),DENY(SYS_ptrace),DENY(SYS_mount),DENY(SYS_umount2),DENY(SYS_bpf),DENY(SYS_perf_event_open),DENY(SYS_unshare),DENY(SYS_setns),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)};
 struct sock_fprog prog={.len=sizeof(filter)/sizeof(filter[0]),.filter=filter};if(prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&prog))die("seccomp");
 struct rlimit cpu={120,120},files={2147483648ULL,2147483648ULL},mem={1536ULL*1024*1024,1536ULL*1024*1024},fds={64,64};
 if(setrlimit(RLIMIT_CPU,&cpu)||setrlimit(RLIMIT_FSIZE,&files)||setrlimit(RLIMIT_AS,&mem)||setrlimit(RLIMIT_NOFILE,&fds))die("limits");
 if(chdir(argv[1]))die("chdir");execv(argv[2],argv+2);die("exec");
}
