import { ApolloClient, ApolloClientOptions, ApolloCache } from '@apollo/client';
import {
  InMemoryCache,
  ApolloReducerConfig,
  NormalizedCacheObject,
} from '@apollo/client/cache';
import { ApolloLink } from '@apollo/client/link/core';
import { createHttpLink } from '@apollo/client/link/http';
import { AuthOptions, AUTH_TYPE } from '@volkanunsal/aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from '@volkanunsal/aws-appsync-subscription-link';
import { createAuthLink } from '@volkanunsal/aws-appsync-auth-link';

export interface AWSAppSyncClientOptions {
  url: string;
  region: string;
  auth: AuthOptions;
  cacheOptions?: ApolloReducerConfig;
}

class AWSAppSyncClient<
  TCacheShape extends NormalizedCacheObject
> extends ApolloClient<TCacheShape> {
  constructor(
    { url, region, auth, cacheOptions = {} }: AWSAppSyncClientOptions,
    options?: Partial<ApolloClientOptions<NormalizedCacheObject>>
  ) {
    const inMemoryCache = new InMemoryCache(cacheOptions);
    const httpLink = createHttpLink({ uri: url });
    const link = ApolloLink.from([
      createAuthLink({ url, region, auth }),
      createSubscriptionHandshakeLink(url, httpLink),
    ]);

    const newOptions: ApolloClientOptions<any> = {
      ...options,
      link,
      cache: inMemoryCache,
    };

    super(newOptions);
  }
}

export default AWSAppSyncClient;
export { AWSAppSyncClient };
export { AUTH_TYPE };
