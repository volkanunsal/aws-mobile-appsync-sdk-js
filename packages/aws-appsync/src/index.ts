import 'setimmediate';
import {
  ApolloClient,
  ApolloClientOptions,
  OperationVariables,
  MutationUpdaterFn,
  ApolloCache,
} from '@apollo/client';
import {
  InMemoryCache,
  ApolloReducerConfig,
  NormalizedCacheObject,
} from '@apollo/client/cache';
import { ApolloLink } from '@apollo/client/link/core';
import { createHttpLink } from '@apollo/client/link/http';
import { AuthOptions, AUTH_TYPE } from '@volkanunsal/aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from '@volkanunsal/aws-appsync-subscription-link';
import { Credentials, CredentialProvider } from '@aws-sdk/types';
import { DocumentNode } from 'graphql';
import { createAuthLink } from '@volkanunsal/aws-appsync-auth-link';

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

  return ApolloLink.from(
    [
      createAuthLink({ url, region, auth }),
      createSubscriptionHandshakeLink(url, httpLink),
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
}

class AWSAppSyncClient<
  TCacheShape extends NormalizedCacheObject
> extends ApolloClient<TCacheShape> {
  constructor(
    {
      url,
      region,
      auth,
      complexObjectsCredentials,
      cacheOptions = {},
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

    const inMemoryCache = new InMemoryCache(cacheOptions);

    const cache: ApolloCache<NormalizedCacheObject> =
      customCache || inMemoryCache;

    const link =
      customLink ||
      createAppSyncLink({
        url,
        region,
        auth,
        complexObjectsCredentials,
      });

    const newOptions: ApolloClientOptions<any> = {
      ...options,
      link,
      cache,
    };

    super(newOptions);
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
