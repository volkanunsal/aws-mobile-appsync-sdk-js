/*!
 * Copyright 2017-2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { S3 } from '@aws-sdk/client-s3';

export default (
  fileField: {
    bucket: string;
    key: string;
    region: string;
    mimeType: string;
    localUri: string;
  },
  { credentials }
) => {
  const {
    bucket: Bucket,
    key: Key,
    region,
    mimeType: ContentType,
    localUri: Body,
  } = fileField;

  const s3 = new S3({
    credentials,
    region,
  });

  return s3.putObject({ Bucket, Key, Body, ContentType });
};
