/*!
 * Copyright 2017-2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import 'setimmediate';
import {
  ApolloClient,
  ApolloClientOptions,
  MutationOptions,
  OperationVariables,
  MutationUpdaterFn,
  ApolloCache,
} from '@apollo/client';
import {
  InMemoryCache,
  ApolloReducerConfig,
  NormalizedCacheObject,
} from '@apollo/client/cache';
import { ApolloLink, NextLink } from '@apollo/client/link/core';
import { Observable } from '@apollo/client/utilities';
import { createHttpLink } from '@apollo/client/link/http';
import { Store } from 'redux';
import { ComplexObjectLink } from './link';
import { StoreOptions, DEFAULT_KEY_PREFIX } from './store';
import {
  AuthOptions,
  AuthLink,
  AUTH_TYPE,
} from '@volkanunsal/aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from '@volkanunsal/aws-appsync-subscription-link';
import { Credentials, CredentialsOptions } from 'aws-sdk/lib/credentials';
import { DocumentNode } from 'graphql';
import { passthroughLink } from './utils';
import ConflictResolutionLink from './link/conflict-resolution-link';
import { createRetryLink } from './link/retry-link';
import { ObservableSubscription } from '@apollo/client/utilities/observables/Observable';
import { PERMANENT_ERROR_KEY } from './link/retry-link';
import { defaultDataIdFromObject } from '@apollo/client/cache';
export { defaultDataIdFromObject };

type OfflineCacheType = any;

class CatchErrorLink extends ApolloLink {
  private link: ApolloLink;

  constructor(linkGenerator: () => ApolloLink) {
    try {
      super();
      this.link = linkGenerator();
    } catch (error) {
      error[PERMANENT_ERROR_KEY] = true;
      throw error;
    }
  }

  request(operation, forward?: NextLink) {
    return this.link.request(operation, forward);
  }
}

class PermanentErrorLink extends ApolloLink {
  private link: ApolloLink;

  constructor(link: ApolloLink) {
    super();

    this.link = link;
  }

  request(operation, forward?: NextLink) {
    return new Observable((observer) => {
      const subscription = this.link.request(operation, forward).subscribe({
        next: observer.next.bind(observer),
        error: (err) => {
          if (err.permanent) {
            err[PERMANENT_ERROR_KEY] = true;
          }
          observer.error.call(observer, err);
        },
        complete: observer.complete.bind(observer),
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }
}

export const createAppSyncLink = ({
  url,
  region,
  auth,
  complexObjectsCredentials,
  resultsFetcherLink = createHttpLink({ uri: url }),
  conflictResolver,
}: {
  url: string;
  region: string;
  auth: AuthOptions;
  complexObjectsCredentials: CredentialsGetter;
  resultsFetcherLink?: ApolloLink;
  conflictResolver?: ConflictResolver;
}) => {
  const link = ApolloLink.from(
    [
      new ConflictResolutionLink(conflictResolver) as ApolloLink,
      new ComplexObjectLink(complexObjectsCredentials),
      createRetryLink(
        ApolloLink.from([
          new CatchErrorLink(() => new AuthLink({ url, region, auth })),
          new PermanentErrorLink(
            createSubscriptionHandshakeLink(
              { url, region, auth },
              resultsFetcherLink
            )
          ),
        ])
      ) as ApolloLink,
    ].filter(Boolean)
  );

  return link;
};

export const createLinkWithCache = (
  createLinkFunc = (_cache: ApolloCache<any>) => new ApolloLink(passthroughLink)
) => {
  let theLink!: ApolloLink;

  return new ApolloLink((op, forward) => {
    if (!theLink) {
      const { cache } = op.getContext();

      theLink = createLinkFunc(cache);
    }

    return theLink.request(op, forward);
  });
};

export interface CacheWithStore<T> extends ApolloCache<T> {
  store: Store<OfflineCacheType>;
}

const createLinkWithStore = (
  createLinkFunc = (_store: Store<OfflineCacheType>) =>
    new ApolloLink(passthroughLink)
) => {
  return createLinkWithCache((cache) => {
    const { store } = cache as CacheWithStore<OfflineCacheType>;

    return store ? createLinkFunc(store) : new ApolloLink(passthroughLink);
  });
};

type CredentialsGetter = () =>
  | (
      | Credentials
      | CredentialsOptions
      | Promise<Credentials>
      | Promise<CredentialsOptions>
      | null
    )
  | Credentials
  | CredentialsOptions
  | Promise<Credentials>
  | Promise<CredentialsOptions>
  | null;

export interface AWSAppSyncClientOptions {
  url: string;
  region: string;
  auth: AuthOptions;
  conflictResolver?: ConflictResolver;
  complexObjectsCredentials?: CredentialsGetter;
  cacheOptions?: ApolloReducerConfig;
  disableOffline?: boolean;
  offlineConfig?: OfflineConfig;
}

export type OfflineConfig = Pick<
  Partial<StoreOptions<any>>,
  'storage' | 'callback' | 'keyPrefix'
> & {
  storeCacheRootMutation?: boolean;
};

// TODO: type defs
export type OfflineCallback = (err: any, success: any) => void;

export interface ConflictResolutionInfo {
  mutation: DocumentNode;
  mutationName: string;
  operationType: string;
  variables: any;
  data: any;
  retries: number;
}

export type ConflictResolver = (obj: ConflictResolutionInfo) => 'DISCARD' | any;

const keyPrefixesInUse = new Set<string>();

class AWSAppSyncClient<
  TCacheShape extends NormalizedCacheObject
> extends ApolloClient<TCacheShape> {
  private hydratedPromise: Promise<AWSAppSyncClient<TCacheShape>>;

  hydrated() {
    return this.hydratedPromise;
  }

  private _disableOffline: boolean;

  constructor(
    {
      url,
      region,
      auth,
      conflictResolver,
      complexObjectsCredentials,
      cacheOptions = {},
      disableOffline = false,
      offlineConfig: { keyPrefix = undefined } = {},
    }: AWSAppSyncClientOptions,
    options?: Partial<ApolloClientOptions<NormalizedCacheObject>>
  ) {
    const { cache: customCache = undefined, link: customLink = undefined } =
      options || {};

    if (!customLink && (!url || !region || !auth)) {
      throw new Error(
        'In order to initialize AWSAppSyncClient, you must specify url, region and auth properties on the config object or a custom link.'
      );
    }

    keyPrefix = keyPrefix || DEFAULT_KEY_PREFIX;
    if (!disableOffline && keyPrefixesInUse.has(keyPrefix)) {
      throw new Error(
        `The keyPrefix ${keyPrefix} is already in use. Multiple clients cannot share the same keyPrefix. Provide a different keyPrefix in the offlineConfig object.`
      );
    }

    const inMemoryCache = new InMemoryCache(cacheOptions);

    const cache: ApolloCache<NormalizedCacheObject> =
      customCache || inMemoryCache;

    const waitForRehydrationLink = new ApolloLink((op, forward) => {
      let handle = null;

      return new Observable((observer) => {
        this.hydratedPromise
          .then(() => {
            handle = passthroughLink(op, forward).subscribe(observer);
          })
          .catch(observer.error);

        return () => {
          if (handle) {
            handle.unsubscribe();
          }
        };
      });
    });
    const apolloLink =
      customLink ||
      createAppSyncLink({
        url,
        region,
        auth,
        complexObjectsCredentials,
        conflictResolver,
      });
    const link = waitForRehydrationLink.concat(apolloLink as ApolloLink);

    const newOptions: ApolloClientOptions<any> = {
      ...options,
      link,
      cache,
    };

    super(newOptions);

    this.hydratedPromise = Promise.resolve(this);
    this._disableOffline = disableOffline;

    if (!disableOffline) {
      keyPrefixesInUse.add(keyPrefix);
    }
  }

  isOfflineEnabled() {
    return !this._disableOffline;
  }

  mutate<T, TVariables = OperationVariables>(
    options: MutationOptions<T, TVariables>
  ) {
    if (!this.isOfflineEnabled()) {
      return super.mutate(options);
    }

    const doIt = false;
    const {
      context: origContext,
      optimisticResponse,
      update,
      fetchPolicy,
      ...otherOptions
    } = options;

    const context = {
      ...origContext,
      AASContext: {
        doIt,
        optimisticResponse,
        update,
        fetchPolicy,
        // updateQueries,
        // refetchQueries,
      },
    };

    return super.mutate({
      optimisticResponse,
      context,
      update,
      fetchPolicy,
      ...otherOptions,
    });
  }

  sync<T, TVariables = OperationVariables>(
    options: SubscribeWithSyncOptions<T, TVariables>
  ): ObservableSubscription {
    if (!this.isOfflineEnabled()) {
      throw new Error('Not supported');
    }

    return new Observable<T>((observer) => {
      let handle: ObservableSubscription;

      return () => {
        if (handle) {
          handle.unsubscribe();
        }
      };
    }).subscribe(() => {});
  }
}

export type QuerySyncOptions<T, TVariables = OperationVariables> = {
  query: DocumentNode;
  variables: TVariables;
  update: MutationUpdaterFn<T>;
};

export type BaseQuerySyncOptions<
  T,
  TVariables = OperationVariables
> = QuerySyncOptions<T, TVariables> & {
  baseRefreshIntervalInSeconds?: number;
};

export type SubscribeWithSyncOptions<T, TVariables = OperationVariables> = {
  baseQuery?: BaseQuerySyncOptions<T, TVariables>;
  subscriptionQuery?: QuerySyncOptions<T, TVariables>;
  deltaQuery?: QuerySyncOptions<T, TVariables>;
};

export default AWSAppSyncClient;
export { AWSAppSyncClient };
export { AUTH_TYPE };
