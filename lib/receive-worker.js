import po6 from "po6";
import stream from "stream";
import structures from "po6/lib/structures/host.js";
import { performance } from "perf_hooks";

export default ({ fd }) => {
  const fdsAsBuffer = structures.pollfd.format({
    fd: BigInt(fd),
    events: po6.POLLIN,
  });

  const timeoutAsBuffer = structures.timespec.format({
    tv_sec: 0n,
    tv_nsec: 100000000n,
  });

  const buffer = Buffer.alloc(16000);

  let readImmediateHandle = undefined;

  const destroy = (err, callback) => {
    clearImmediate(readImmediateHandle);
    callback();
  };

  let readable = undefined;

  const read = () => {
    const tryReadNext = () => {
      try {
        const result = po6.ppoll.sync({ fdsAsBuffer, timeoutAsBuffer });

        if (result === 0n) {
          readImmediateHandle = setImmediate(tryReadNext);
          return;
        }

        const readLength = po6.read.sync({ fd, buffer });
  
        const dataLength = Number(readLength);
        const data = Buffer.alloc(dataLength);
        buffer.copy(data, 0, 0, dataLength);
  
        readable.push(data);
      } catch (ex) {

        if (ex.message.includes("Interrupted system call")) {
          setImmediate(tryReadNext);
        } else {
          throw ex;
        }
      }
    };
    tryReadNext();
  };

  readable = stream.Readable({
    read,
    destroy,
    objectMode: true,
  });

  return readable;
};
