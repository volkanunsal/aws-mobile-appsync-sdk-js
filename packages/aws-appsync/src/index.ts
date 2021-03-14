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
import { KEY_PREFIX as DEFAULT_KEY_PREFIX } from 'redux-persist';
import {
  AuthOptions,
  AuthLink,
  AUTH_TYPE,
} from '@volkanunsal/aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from '@volkanunsal/aws-appsync-subscription-link';
import { Credentials, CredentialProvider } from '@aws-sdk/types';
import { DocumentNode } from 'graphql';
import { passthroughLink } from './utils';
import { createRetryLink } from './link/retry-link';
import { PERMANENT_ERROR_KEY } from './link/retry-link';
import { createAuthLink } from '@volkanunsal/aws-appsync-auth-link';

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
}: {
  url: string;
  region: string;
  auth: AuthOptions;
  complexObjectsCredentials: CredentialsGetter;
  resultsFetcherLink?: ApolloLink;
}) => {
  const httpLink = createHttpLink({ uri: url });

  const retryLink: ApolloLink = createRetryLink(
    ApolloLink.from([
      new CatchErrorLink(() => new AuthLink({ url, region, auth })),
      new PermanentErrorLink(
        createSubscriptionHandshakeLink(
          { url, region, auth },
          resultsFetcherLink
        )
      ),
    ])
  );

  return ApolloLink.from(
    [
      createAuthLink({ url, region, auth }),
      createSubscriptionHandshakeLink(url, httpLink),
      retryLink,
    ].filter(Boolean)
  );
};

type CredentialsGetter = () => Credentials | CredentialProvider | null;

export interface AWSAppSyncClientOptions {
  url: string;
  region: string;
  auth: AuthOptions;
  complexObjectsCredentials?: CredentialsGetter;
  cacheOptions?: ApolloReducerConfig;
  disableOffline?: boolean;
}

// TODO: type defs
export type OfflineCallback = (err: any, success: any) => void;

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
      complexObjectsCredentials,
      cacheOptions = {},
      disableOffline = false,
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

    let keyPrefix = DEFAULT_KEY_PREFIX;
    if (!disableOffline && keyPrefixesInUse.has(keyPrefix)) {
      throw new Error(
        `The keyPrefix ${keyPrefix} is already in use. Multiple clients cannot share the same keyPrefix.`
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
