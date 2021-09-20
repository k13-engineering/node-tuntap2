import fs from "fs";
import rxjs from "rxjs";

const fdSource = ({ filename, flags }) => {
  return new rxjs.Observable((subscriber) => {
    let unsubscribed = false;
    let openedFd = undefined;

    fs.open(filename, flags, (err, fd) => {
      if (unsubscribed) {
        fs.close(fd);
        return;
      }

      openedFd = fd;

      if (err) {
        subscriber.error(err);
      } else {
        subscriber.next({ fd });
      }
    });

    const unsubscribe = () => {
      if (openedFd !== undefined) {
        fs.close(openedFd);
      }
      unsubscribed = true;
    };

    return unsubscribe;
  });
};

export default {
  fdSource,
};
