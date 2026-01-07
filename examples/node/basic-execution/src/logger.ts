import fs from 'fs';

const ROOT = './logs/';

export class Logger {
  static info(id: string, value: any) {
    addToLogs(id, value);
  }

  static error(id: string, value: any) {
    addToLogs(id, value, true);
  }
}

function addToLogs(id: string, value: any, addToErrorsFile: boolean = false) {
  if (!fs.existsSync(ROOT)) {
    fs.mkdirSync(ROOT, { recursive: true });
  }

  const time = getCurrentTime();
  value.time = time;

  if (addToErrorsFile) {
    value.isError = true;
  }

  const path = ROOT + id + '.txt';
  fs.appendFileSync(path, JSON.stringify(value));
  fs.appendFileSync(path, '\n', { flush: true });

  if (!addToErrorsFile) {
    return;
  }

  const errorPath = ROOT + id + '_errors' + '.txt';
  fs.appendFileSync(errorPath, JSON.stringify(value));
  fs.appendFileSync(errorPath, '\n', { flush: true });
  console.log(JSON.stringify(value));
}

function getCurrentTime(): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  let time = '';
  if (hours < 10) {
    time += '0';
  }
  time += hours + ':';

  if (minutes < 10) {
    time += '0';
  }
  time += minutes + ':';

  if (seconds < 10) {
    time += '0';
  }
  time += seconds;
  return time;
}

export function stringifyError(err: any) {
  return JSON.stringify({
    message: err.message,
    stack: err.stack,
    name: err.name,
    ...err, // include extra enumerable fields
  });
}
