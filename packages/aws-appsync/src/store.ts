/*!
 * Copyright 2017-2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { rootLogger } from './utils';
import {
  applyMiddleware,
  createStore,
  compose,
  combineReducers,
  Store,
} from 'redux';
import { KEY_PREFIX as REDUX_PERSIST_KEY_PREFIX } from 'redux-persist';
import thunk from 'redux-thunk';

import { AWSAppSyncClient, OfflineCallback } from './client';
import { NormalizedCacheObject } from '@apollo/client/cache';

const logger = rootLogger.extend('store');

export type StoreOptions<TCacheShape extends NormalizedCacheObject> = {
  clientGetter: () => AWSAppSyncClient<TCacheShape>;
  persistCallback: () => void;
  dataIdFromObject: (obj: any) => string | null;
  keyPrefix?: string;
  storage?: any;
  callback: OfflineCallback;
};

export const DEFAULT_KEY_PREFIX = REDUX_PERSIST_KEY_PREFIX;

const newStore = <
  TCacheShape extends NormalizedCacheObject
>({}: StoreOptions<TCacheShape>): Store<any> => {
  logger('Creating store');

  const store = createStore(
    combineReducers({}),
    typeof window !== 'undefined' &&
      (window as any).__REDUX_DEVTOOLS_EXTENSION__ &&
      (window as any).__REDUX_DEVTOOLS_EXTENSION__(),
    compose(applyMiddleware(thunk))
  );

  return store;
};

export { newStore as createStore };
