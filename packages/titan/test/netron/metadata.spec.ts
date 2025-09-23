import { Service1 } from './fixtures/service1';
import { Service2 } from './fixtures/service2';
import { isNetronService, SERVICE_ANNOTATION } from '../../src/netron';

describe('Packet', () => {
  it('complex metadata', () => {
    const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, Service1);
    expect(JSON.stringify(metadata, null, 2)).toEqual(`{
  "name": "service1",
  "version": "",
  "properties": {
    "name": {
      "type": "String",
      "readonly": false
    },
    "description": {
      "type": "String",
      "readonly": false
    },
    "data": {
      "type": "Object",
      "readonly": false
    },
    "isActive": {
      "type": "Boolean",
      "readonly": true
    }
  },
  "methods": {
    "greet": {
      "type": "String",
      "arguments": []
    },
    "echo": {
      "type": "String",
      "arguments": [
        "String"
      ]
    },
    "addNumbers": {
      "type": "Number",
      "arguments": [
        "Number",
        "Number"
      ]
    },
    "concatenateStrings": {
      "type": "String",
      "arguments": [
        "String",
        "String"
      ]
    },
    "getBooleanValue": {
      "type": "Boolean",
      "arguments": [
        "Boolean"
      ]
    },
    "getObjectProperty": {
      "type": "String",
      "arguments": [
        "Object"
      ]
    },
    "getArrayElement": {
      "type": "Object",
      "arguments": [
        "Array",
        "Number"
      ]
    },
    "fetchData": {
      "type": "Promise",
      "arguments": [
        "String"
      ]
    },
    "updateData": {
      "type": "void",
      "arguments": [
        "String",
        "Object"
      ]
    },
    "getDataKeys": {
      "type": "Array",
      "arguments": []
    },
    "delay": {
      "type": "Promise",
      "arguments": [
        "Number"
      ]
    },
    "fetchDataWithDelay": {
      "type": "Promise",
      "arguments": [
        "String",
        "Number"
      ]
    },
    "updateDataWithDelay": {
      "type": "Promise",
      "arguments": [
        "String",
        "Object",
        "Number"
      ]
    },
    "getStatus": {
      "type": "String",
      "arguments": []
    },
    "getPriority": {
      "type": "Number",
      "arguments": []
    },
    "getAllStatuses": {
      "type": "Array",
      "arguments": []
    },
    "getAllPriorities": {
      "type": "Array",
      "arguments": []
    },
    "getUndefined": {
      "type": "void",
      "arguments": []
    },
    "getNull": {
      "type": "void",
      "arguments": []
    },
    "getSymbol": {
      "type": "Symbol",
      "arguments": []
    },
    "getBigInt": {
      "type": "BigInt",
      "arguments": []
    },
    "getDate": {
      "type": "Date",
      "arguments": []
    },
    "getRegExp": {
      "type": "RegExp",
      "arguments": []
    },
    "getMap": {
      "type": "Map",
      "arguments": []
    },
    "getSet": {
      "type": "Set",
      "arguments": []
    },
    "getPromise": {
      "type": "Promise",
      "arguments": []
    }
  }
}`);
  });

  it('check context predicate', () => {
    const ctx1 = new Service1();
    const ctx2 = new Service2();

    expect(isNetronService(ctx1)).toBe(true);
    expect(isNetronService(ctx2)).toBe(true);
  });

  it('metadata with custom type', () => {
    const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, Service2);
    expect(JSON.stringify(metadata, null, 2)).toEqual(`{
  "name": "service2",
  "version": "",
  "properties": {
    "name": {
      "type": "String",
      "readonly": false
    }
  },
  "methods": {
    "getService1": {
      "type": "Service1",
      "arguments": []
    },
    "getNewService1": {
      "type": "Service1",
      "arguments": [
        "String",
        "String"
      ]
    },
    "addNumbers": {
      "type": "Number",
      "arguments": [
        "Number",
        "Number"
      ]
    }
  }
}`);
  });
});
