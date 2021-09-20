#include <stdio.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <linux/if.h>
#include <linux/if_tun.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <endian.h>

int main(int argc, char* argv[]) {
  printf("TUNGETIFF = 0x%x\n", TUNGETIFF);
  printf("sizeof(struct ifreq) = %i\n", IFNAMSIZ);
}
