import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Injectable()
class Dependency {}

@Injectable()
class Consumer {
  constructor(readonly dependency: Dependency) {}
}

@Module({ providers: [Dependency, Consumer] })
class TestModule {}

test('compilação dos testes preserva injeção NestJS por construtor', async () => {
  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
  });
  try {
    assert.ok(app.get(Consumer).dependency instanceof Dependency);
    assert.equal(app.get(Consumer).dependency, app.get(Dependency));
  } finally {
    await app.close();
  }
});
