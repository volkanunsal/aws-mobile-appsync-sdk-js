/*!
 * Copyright 2017-2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { DocumentNode, OperationDefinitionNode, FieldNode } from 'graphql';
import { resultKeyNameFromField } from '@apollo/client/utilities';
import { Observable } from '@apollo/client/utilities';
import {
  InMemoryCache,
  NormalizedCache,
  NormalizedCacheObject,
} from '@apollo/client';
import { EntityStore } from '@apollo/client/cache/inmemory/entityStore';

export function defaultNormalizedCacheFactory(
  seed?: NormalizedCacheObject
): NormalizedCache {
  const cache = new InMemoryCache();
  return new EntityStore.Root({
    policies: cache.policies,
    resultCaching: true,
    seed,
  });
}

export function tryFunctionOrLogError(f: () => void) {
  try {
    return f();
  } catch (e) {
    if (console.error) {
      console.error(e);
    }
  }
}

const crypto = require('aws-sdk/global').util.crypto;

export const passthroughLink = (op, forward) =>
  forward ? forward(op) : Observable.of();

export const isUuid = (val) =>
  typeof val === 'string' &&
  val.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

export const getOperationFieldName = (operation: DocumentNode): string =>
  resultKeyNameFromField(
    (operation.definitions[0] as OperationDefinitionNode).selectionSet
      .selections[0] as FieldNode
  );

export const hash = (src: any) =>
  crypto
    .createHash('sha256')
    .update(src || {}, 'utf8')
    .digest('hex') as string;

export { default as rootLogger } from './logger';
