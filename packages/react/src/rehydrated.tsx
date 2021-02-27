/*!
 * Copyright 2017-2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useContext, useState, Fragment } from 'react';
import AWSAppSyncClient from '@volkanunsal/aws-appsync';
import { getApolloContext, NormalizedCacheObject } from '@apollo/client';

export interface RehydrateProps {
  rehydrated: boolean;
  children: React.ReactNode;
}

const Rehydrate = (props: RehydrateProps) => (
  <div
    className={`awsappsync ${
      props.rehydrated ? 'awsappsync--rehydrated' : 'awsappsync--rehydrating'
    }`}
  >
    {props.rehydrated ? props.children : <span>Loading...</span>}
  </div>
);

export interface RehydratedProps {
  render?: (props: { rehydrated: boolean }) => React.ReactElement;
  children?: React.ReactElement;
  loading?: React.ComponentType<any>;
}

export default function Rehydrated<T extends NormalizedCacheObject>({
  render,
  children,
  loading,
}: RehydratedProps) {
  const {
    client,
  }: {
    client?: AWSAppSyncClient<T>;
  } = useContext(getApolloContext() as any);

  const [rehydrated, setHydra] = useState(false);

  useEffect(() => {
    client.hydrated().then(() => {
      setHydra(true);
    });
  }, [client]);

  if (render) return render({ rehydrated });
  if (!children) return null;

  if (loading) return rehydrated ? <Fragment>children</Fragment> : loading;
  return <Rehydrate rehydrated={rehydrated}>{children}</Rehydrate>;
}
