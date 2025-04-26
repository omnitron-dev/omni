

import { z } from 'zod';
import { Test } from '@nestjs/testing';
import * as supertest from 'supertest';
import { initContract } from '@devgrid/rest-core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  Type,
  Controller,
  ModuleMetadata,
  INestApplication,
} from '@nestjs/common';

import { TsRest } from '../src/ts-rest.decorator';
import { TsRestRequest } from '../src/ts-rest-request.decorator';
import {
  NestRequestShapes,
  NestResponseShapes,
  nestControllerContract,
} from '../src/ts-rest-nest';

const c = initContract();
const postsRouter = c.router({
  getPost: {
    method: 'GET',
    path: `/posts/:id`,
    responses: {
      200: null,
    },
  },
});

describe('request validation', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  const initializeApp = async (controller: Type) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [controller],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    return app.getHttpServer();
  };

  const contract = initContract().router({
    withBody: {
      method: 'POST',
      path: `/`,
      body: z.object({
        title: z.string(),
      }),
      responses: {
        200: z.object({
          title: z.string(),
        }),
      },
    },
    withQuery: {
      method: 'GET',
      path: '/',
      query: z.object({
        id: z.string(),
      }),
      responses: {
        200: z.object({
          title: z.string(),
        }),
      },
    },
    withHeaders: {
      method: 'GET',
      path: '/admin',
      headers: z.object({
        token: z.string(),
      }),
      responses: {
        200: z.object({
          title: z.string(),
        }),
      },
    },
  });

  const nestContract = nestControllerContract(contract);
  type contractType = typeof nestContract;
  type RequestShapes = NestRequestShapes<contractType>;
  type ResponseShapes = NestResponseShapes<typeof nestContract>;

  it('should validate body without validateRequestBody param', async () => {
    @Controller()
    @TsRest({})
    class MyController {
      @TsRest(contract.withBody)
      async create(@TsRestRequest() { body }: RequestShapes['withBody']) {
        const response: ResponseShapes['withBody'] = {
          status: 200,
          body: { title: body.title },
        };

        return response;
      }
    }

    const server = await initializeApp(MyController);
    const serverResponse = await supertest(server)
      .post(contract.withBody.path)
      .send({ title: 123 });

    expect(serverResponse.status).toEqual(400);
    expect(serverResponse.body.issues.length > 0).toBeTruthy();
    expect(serverResponse.body.issues[0].code).toBe('invalid_type');
  });

  it('should validate body with validateRequestBody: true', async () => {
    @Controller()
    @TsRest({
      validateRequestBody: true,
    })
    class MyController {
      @TsRest(contract.withBody)
      async create(@TsRestRequest() { body }: RequestShapes['withBody']) {
        const response: ResponseShapes['withBody'] = {
          status: 200,
          body: { title: body.title },
        };

        return response;
      }
    }

    const server = await initializeApp(MyController);
    const serverResponse = await supertest(server)
      .post(contract.withBody.path)
      .send({ title: 123 });

    expect(serverResponse.status).toEqual(400);
    expect(serverResponse.body.issues.length > 0).toBeTruthy();
    expect(serverResponse.body.issues[0].code).toBe('invalid_type');
  });

  it('route param should override class param', async () => {
    @Controller()
    @TsRest({
      validateRequestBody: true,
    })
    class TestController {
      @TsRest(contract.withBody, {
        validateRequestBody: false,
      })
      async create(@TsRestRequest() { body }: RequestShapes['withBody']) {
        const response: ResponseShapes['withBody'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .post(contract.withBody.path)
      .send({ title: 432213 });

    expect(serverResponse.status).toEqual(200);
    expect(serverResponse.body.title).toBe('ok');
  });

  it("only method param - shouldn't validate body", async () => {
    @Controller()
    class TestController {
      @TsRest(contract.withBody, {
        validateRequestBody: false,
      })
      async create(@TsRestRequest() { body }: RequestShapes['withBody']) {
        const response: ResponseShapes['withBody'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .post(contract.withBody.path)
      .send({ title: 432213 });

    expect(serverResponse.status).toEqual(200);
    expect(serverResponse.body.title).toBe('ok');
  });

  it("shouldn't validate body", async () => {
    @Controller()
    @TsRest({
      validateRequestBody: false,
    })
    class TestController {
      @TsRest(contract.withBody)
      async create(@TsRestRequest() { body }: RequestShapes['withBody']) {
        const response: ResponseShapes['withBody'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .post(contract.withBody.path)
      .send({ title: 432213 });

    expect(serverResponse.status).toEqual(200);
    expect(serverResponse.body.title).toBe('ok');
  });

  it('should validate headers', async () => {
    @Controller()
    @TsRest({
      validateRequestHeaders: true,
    })
    class TestController {
      @TsRest(contract.withHeaders)
      async create(@TsRestRequest() { headers }: RequestShapes['withHeaders']) {
        const response: ResponseShapes['withHeaders'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .get(contract.withHeaders.path)
      .send();

    expect(serverResponse.status).toEqual(400);
    expect(serverResponse.body.issues.length > 0).toBeTruthy();
    expect(serverResponse.body.issues[0].code).toBe('invalid_type');
    expect(serverResponse.body.issues[0].path[0]).toBe('token');
  });

  it("shouldn't validate headers", async () => {
    @Controller()
    @TsRest({
      validateRequestHeaders: false,
    })
    class TestController {
      @TsRest(contract.withHeaders)
      async create(@TsRestRequest() { headers }: RequestShapes['withHeaders']) {
        const response: ResponseShapes['withHeaders'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .get(contract.withHeaders.path)
      .send();

    expect(serverResponse.status).toEqual(200);
    expect(serverResponse.body.title).toBe('ok');
  });

  it('should validate query', async () => {
    @Controller()
    @TsRest({
      validateRequestQuery: true,
    })
    class TestController {
      @TsRest(contract.withQuery)
      async create(@TsRestRequest() { headers }: RequestShapes['withQuery']) {
        const response: ResponseShapes['withQuery'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .get(contract.withQuery.path)
      .send();

    expect(serverResponse.status).toEqual(400);
    expect(serverResponse.body.issues.length > 0).toBeTruthy();
    expect(serverResponse.body.issues[0].code).toBe('invalid_type');
    expect(serverResponse.body.issues[0].path[0]).toBe('id');
  });

  it("shouldn't validate query", async () => {
    @Controller()
    @TsRest({
      validateRequestQuery: false,
    })
    class TestController {
      @TsRest(contract.withQuery)
      async create(@TsRestRequest() { headers }: RequestShapes['withQuery']) {
        const response: ResponseShapes['withQuery'] = {
          status: 200,
          body: { title: 'ok' },
        };

        return response;
      }
    }

    const server = await initializeApp(TestController);
    const serverResponse = await supertest(server)
      .get(contract.withQuery.path)
      .send();

    expect(serverResponse.status).toEqual(200);
    expect(serverResponse.body.title).toBe('ok');
  });
});

describe('ts-rest-nest', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  const initializeApp = async (
    moduleMetadata: ModuleMetadata = {},
    adapter: 'express' | 'fastify' = 'express',
  ) => {
    const moduleRef = await Test.createTestingModule(moduleMetadata).compile();

    app =
      adapter === 'express'
        ? moduleRef.createNestApplication()
        : moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );

    await app.init();

    if (adapter === 'fastify') {
      await app.getHttpAdapter().getInstance().ready();
    }

    return app.getHttpServer();
  };
});