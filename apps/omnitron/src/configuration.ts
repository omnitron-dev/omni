// @ts-nocheck

export const Configuration: any = {};

import fs from 'fs';
import eachSeries from 'async/eachSeries';

import cst from './constants';
import { Common } from './common';

function splitKey(key: string): string[] {
  let values = [key];

  if (key.indexOf('.') > -1) values = key.match(/(?:[^."]+|"[^"]*")+/g)!.map((dt) => dt.replace(/"/g, ''));
  else if (key.indexOf(':') > -1) values = key.match(/(?:[^:"]+|"[^"]*")+/g)!.map((dt) => dt.replace(/"/g, ''));

  return values;
}

function serializeConfiguration(json_conf: any): string {
  return JSON.stringify(json_conf, null, 4);
}

Configuration.set = function (key: string, value: any, cb: (err: Error | null, data?: any) => void): void {
  fs.readFile(cst.OMNITRON_MODULE_CONF_FILE, (err, data) => {
    if (err) {
      cb(err);
      return;
    }

    const json_conf = JSON.parse(data.toString());

    const values = splitKey(key);

    if (values.length > 0) {
      const levels = values;

      let tmp = json_conf;

      levels.forEach((key, index) => {
        if (index == levels.length - 1) tmp[key] = value;
        else if (!tmp[key]) {
          tmp[key] = {};
          tmp = tmp[key];
        } else {
          if (typeof tmp[key] != 'object') tmp[key] = {};
          tmp = tmp[key];
        }
      });
    } else {
      if (json_conf[key] && typeof json_conf[key] === 'string')
        Common.printOut(cst.PREFIX_MSG + 'Replacing current value key %s by %s', key, value);

      json_conf[key] = value;
    }

    fs.writeFile(cst.OMNITRON_MODULE_CONF_FILE, serializeConfiguration(json_conf), (err) => {
      if (err) {
        cb(err);
        return;
      }

      cb(null, json_conf);
    });
  });
};

Configuration.unset = function (key: string, cb: (err: Error | null, data?: any) => void): void {
  fs.readFile(cst.OMNITRON_MODULE_CONF_FILE, (err, data) => {
    if (err) {
      cb(err);
      return;
    }

    let json_conf = JSON.parse(data.toString());

    const values = splitKey(key);

    if (values.length > 0) {
      const levels = values;

      let tmp = json_conf;

      levels.forEach((key, index) => {
        if (index == levels.length - 1) delete tmp[key];
        else if (!tmp[key]) {
          tmp[key] = {};
          tmp = tmp[key];
        } else {
          if (typeof tmp[key] != 'object') tmp[key] = {};
          tmp = tmp[key];
        }
      });
    } else delete json_conf[key];

    if (err) {
      cb(err);
      return;
    }
    if (key === 'all') json_conf = {};

    fs.writeFile(cst.OMNITRON_MODULE_CONF_FILE, serializeConfiguration(json_conf), (err) => {
      if (err) {
        cb(err);
        return;
      }

      cb(null, json_conf);
    });
  });
};

Configuration.setSyncIfNotExist = function (key: string, value: any): any {
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(cst.OMNITRON_MODULE_CONF_FILE));
  } catch (e) {
    return null;
  }
  const values = splitKey(key);
  let exists = false;

  if (values.length > 1 && conf && conf[values[0]]) {
    exists = Object.keys(conf[values[0]]).some((key) => {
      if (key == values[1]) return true;
      return false;
    });
  }

  if (exists === false) return Configuration.setSync(key, value);

  return null;
};

Configuration.setSync = function (key: string, value: any): any {
  let data;
  try {
    data = fs.readFileSync(cst.OMNITRON_MODULE_CONF_FILE);
  } catch (e) {
    return null;
  }

  let json_conf = JSON.parse(data);

  const values = splitKey(key);

  if (values.length > 0) {
    const levels = values;

    let tmp = json_conf;

    levels.forEach((key, index) => {
      if (index == levels.length - 1) tmp[key] = value;
      else if (!tmp[key]) {
        tmp[key] = {};
        tmp = tmp[key];
      } else {
        if (typeof tmp[key] != 'object') tmp[key] = {};
        tmp = tmp[key];
      }
    });
  } else {
    if (json_conf[key] && typeof json_conf[key] === 'string')
      Common.printOut(cst.PREFIX_MSG + 'Replacing current value key %s by %s', key, value);

    json_conf[key] = value;
  }

  if (key === 'all') json_conf = {};
  try {
    fs.writeFileSync(cst.OMNITRON_MODULE_CONF_FILE, serializeConfiguration(json_conf));
    return json_conf;
  } catch (e: any) {
    console.error(e.message);
    return null;
  }
};

Configuration.unsetSync = function (key: string): any {
  let data;
  try {
    data = fs.readFileSync(cst.OMNITRON_MODULE_CONF_FILE);
  } catch (e: any) {
    return null;
  }

  let json_conf = JSON.parse(data);

  const values = splitKey(key);

  if (values.length > 0) {
    const levels = values;

    let tmp = json_conf;

    levels.forEach((key, index) => {
      if (index == levels.length - 1) delete tmp[key];
      else if (!tmp[key]) {
        tmp[key] = {};
        tmp = tmp[key];
      } else {
        if (typeof tmp[key] != 'object') tmp[key] = {};
        tmp = tmp[key];
      }
    });
  } else delete json_conf[key];

  if (key === 'all') json_conf = {};

  try {
    fs.writeFileSync(cst.OMNITRON_MODULE_CONF_FILE, serializeConfiguration(json_conf));
  } catch (e: any) {
    console.error(e.message);
    return null;
  }
};

Configuration.multiset = function (serial: string, cb: (err: Error | null) => void): void {
  const arrays: [string, string][] = [];
  const parts = serial.match(/(?:[^ "]+|"[^"]*")+/g);

  while (parts.length > 0) arrays.push(parts.splice(0, 2));

  eachSeries(
    arrays,
    (el, next) => {
      Configuration.set(el[0], el[1], next);
    },
    cb
  );
};

Configuration.get = function (key: string, cb: (err: Error | null, data?: any) => void): void {
  Configuration.getAll((err, data) => {
    const climb = splitKey(key);

    climb.some((val) => {
      if (!data[val]) {
        data = null;
        return true;
      }
      data = data[val];
      return false;
    });

    if (!data) return cb({ err: 'Unknown key' }, null);
    return cb(null, data);
  });
};

Configuration.getSync = function (key: string): any {
  try {
    let data = Configuration.getAllSync();
    const climb = splitKey(key);

    climb.some((val) => {
      if (!data[val]) {
        data = null;
        return true;
      }
      data = data[val];
      return false;
    });

    if (!data) return null;
    return data;
  } catch (e) {
    return null;
  }
};

Configuration.getAll = function (cb: (err: Error | null, data?: any) => void): void {
  fs.readFile(cst.OMNITRON_MODULE_CONF_FILE, (err, data) => {
    if (err) return cb(err);
    return cb(null, JSON.parse(data));
  });
};

Configuration.getAllSync = function (): any {
  try {
    return JSON.parse(fs.readFileSync(cst.OMNITRON_MODULE_CONF_FILE));
  } catch (e) {
    console.error((e as Error).stack || e);
    return {};
  }
};
