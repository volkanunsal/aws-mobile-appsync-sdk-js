import { ApolloLink, NextLink, Observable, Operation } from '@apollo/client';
import { print } from 'graphql/language/printer';
import { Signer, ConsoleLogger as Logger } from '@aws-amplify/core';
import { userAgent } from './platform';
import { Credentials, CredentialProvider } from '@aws-sdk/types';

const VERSION = '1.0.0';
const SERVICE = 'appsync';
export const USER_AGENT_HEADER = 'x-amz-user-agent';
export const USER_AGENT = `aws-amplify/${VERSION}${
  userAgent && ' '
}${userAgent}`;

const logger = new Logger('AuthLink');

export enum AUTH_TYPE {
  NONE = 'NONE',
  API_KEY = 'API_KEY',
  AWS_IAM = 'AWS_IAM',
  AMAZON_COGNITO_USER_POOLS = 'AMAZON_COGNITO_USER_POOLS',
  OPENID_CONNECT = 'OPENID_CONNECT',
}

export class AuthLink extends ApolloLink {
  private link: ApolloLink;

  /**
   *
   * @param {*} options
   */
  constructor(options) {
    super();

    this.link = authLink(options);
  }

  request(operation, forward) {
    return this.link.request(operation, forward);
  }
}

interface Headers {
  header: string;
  value: string | (() => string | Promise<string>);
}

const headerBasedAuth = async (
  { header, value }: Headers = { header: '', value: '' },
  operation,
  forward
) => {
  const origContext = operation.getContext();
  let headers = {
    ...origContext.headers,
    [USER_AGENT_HEADER]: USER_AGENT,
  };

  if (header && value) {
    const headerValue =
      typeof value === 'function' ? await value.call(undefined) : await value;

    headers = {
      ...{ [header]: headerValue },
      ...headers,
    };
  }

  operation.setContext({
    ...origContext,
    headers,
  });

  return forward(operation);
};

const iamBasedAuth = async (
  {
    credentials,
    region,
    url,
  }: {
    credentials:
      | (() => { getPromise: () => Promise<Record<string, any>> })
      | Record<string, any>;
    region: string;
    url: string;
  },
  operation: Operation,
  forward: NextLink
) => {
  const service = SERVICE;
  const origContext = operation.getContext();

  const credentials2 =
    typeof credentials === 'function'
      ? credentials.call(null)
      : credentials || {};

  if (
    credentials2 &&
    typeof credentials2 !== 'function' &&
    typeof credentials2.getPromise === 'function'
  ) {
    await credentials2.getPromise();
  }

  const { accessKeyId, secretAccessKey, sessionToken } = await credentials2;

  const { host, pathname: path } = new URL(url);

  const { query, variables } = operation;

  const body = {
    variables: removeTemporaryVariables(variables),
    query: print(query),
  };

  const formatted = {
    body: JSON.stringify(body),
    method: 'POST',
    headers: {
      ...origContext.headers,
      'content-type': 'application/json; charset=UTF-8',
      [USER_AGENT_HEADER]: USER_AGENT,
    },
    service,
    region,
    url,
    host,
    path,
  };

  const creds = {
    secret_key: secretAccessKey,
    access_key: accessKeyId,
    session_token: sessionToken,
  };
  const endpointInfo = { region, service };
  const signerServiceInfo = endpointInfo;
  const signed_params = Signer.sign(formatted, creds, signerServiceInfo);
  const { headers } = signed_params;

  logger.debug('Signed Request: ', signed_params);

  delete headers['host'];

  operation.setContext({
    ...origContext,
    headers,
  });

  return forward(operation);
};

type KeysWithType<O, T> = {
  [K in keyof O]: O[K] extends T ? K : never;
}[keyof O];
type AuthOptionsNone = { type: AUTH_TYPE.NONE };
type AuthOptionsIAM = {
  type: KeysWithType<typeof AUTH_TYPE, AUTH_TYPE.AWS_IAM>;
  credentials: Credentials | CredentialProvider | null;
};
type AuthOptionsApiKey = {
  type: KeysWithType<typeof AUTH_TYPE, AUTH_TYPE.API_KEY>;
  apiKey: (() => string | Promise<string>) | string;
};
type AuthOptionsOAuth = {
  type:
    | KeysWithType<typeof AUTH_TYPE, AUTH_TYPE.AMAZON_COGNITO_USER_POOLS>
    | KeysWithType<typeof AUTH_TYPE, AUTH_TYPE.OPENID_CONNECT>;
  jwtToken: (() => string | Promise<string>) | string;
};
export type AuthOptions =
  | AuthOptionsNone
  | AuthOptionsIAM
  | AuthOptionsApiKey
  | AuthOptionsOAuth;

const authLink = ({ url, region, auth: { type } = <AuthOptions>{}, auth }) => {
  return new ApolloLink((operation, forward) => {
    return new Observable((observer) => {
      let handle;

      let promise: Promise<Observable<any>>;

      switch (type) {
        case AUTH_TYPE.NONE:
          promise = headerBasedAuth(undefined, operation, forward);
          break;
        case AUTH_TYPE.AWS_IAM:
          const { credentials = {} } = auth;
          promise = iamBasedAuth(
            {
              credentials,
              region,
              url,
            },
            operation,
            forward
          );
          break;
        case AUTH_TYPE.API_KEY:
          const { apiKey = '' } = auth;
          promise = headerBasedAuth(
            { header: 'X-Api-Key', value: apiKey },
            operation,
            forward
          );
          break;
        case AUTH_TYPE.AMAZON_COGNITO_USER_POOLS:
        case AUTH_TYPE.OPENID_CONNECT:
          const { jwtToken = '' } = auth;
          promise = headerBasedAuth(
            { header: 'Authorization', value: jwtToken },
            operation,
            forward
          );
          break;
        default:
          const error = new Error(
            `Invalid AUTH_TYPE: ${(<AuthOptions>auth).type}`
          );

          throw error;
      }

      promise.then((observable) => {
        handle = observable.subscribe({
          next: observer.next.bind(observer),
          error: observer.error.bind(observer),
          complete: observer.complete.bind(observer),
        });
      });

      return () => {
        if (handle) handle.unsubscribe();
      };
    });
  });
};

/**
 * Removes all temporary variables (starting with '@@') so that the signature matches the final request.
 */
const removeTemporaryVariables = (variables: any) =>
  Object.keys(variables)
    .filter((key) => !key.startsWith('@@'))
    .reduce((acc, key) => {
      acc[key] = variables[key];
      return acc;
    }, {});

export const createAuthLink = ({
  url,
  region,
  auth,
}: {
  url: string;
  region: string;
  auth: AuthOptions;
}) => new AuthLink({ url, region, auth });
