export interface AdminFileRecord {
  productVersion: string;
  sha256: string;
  size: number;
  createdAt: string;
  fileName: string;
}

export interface FileUploadResponse {
  productVersion: string;
  sha256: string;
}

export type AdminFileKind = 'setup' | 'firmware';

export interface PreparedAdminFile {
  kind: AdminFileKind;
  file: File;
  productVersion: string;
  sha256: string;
  size: number;
}

interface SavePickerFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface WindowWithSaveFilePicker extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SavePickerFileHandle>;
}

function isFileUploadResponse(value: unknown): value is FileUploadResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'productVersion' in value &&
    typeof value.productVersion === 'string' &&
    'sha256' in value &&
    typeof value.sha256 === 'string'
  );
}

function isAdminFileRecord(value: unknown): value is AdminFileRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'productVersion' in value &&
    typeof value.productVersion === 'string' &&
    'sha256' in value &&
    typeof value.sha256 === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    'fileName' in value &&
    typeof value.fileName === 'string'
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();
  let result: unknown;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      response.ok
        ? 'The backend returned an invalid response.'
        : `Request failed with HTTP ${response.status}.`,
    );
  }

  if (!response.ok) {
    const message =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : `Request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  return result;
}

function getAdminHeaders(adminApiKey: string): HeadersInit {
  const key = adminApiKey.trim();
  if (!key) {
    throw new Error('Enter the admin API key in the sidebar.');
  }

  return { 'x-admin-api-key': key };
}

async function getAllFiles(path: string, adminApiKey: string) {
  const response = await fetch(path, {
    headers: getAdminHeaders(adminApiKey),
  });
  const result = await readJsonResponse(response);

  if (!Array.isArray(result) || !result.every(isAdminFileRecord)) {
    throw new Error('The backend returned an unexpected file list format.');
  }

  return result;
}

export function getAllSetupFiles(adminApiKey: string) {
  return getAllFiles(
    '/api/admin/setup-files/get-all-setup-files',
    adminApiKey,
  );
}

export function getAllFirmwareFiles(adminApiKey: string) {
  return getAllFiles(
    '/api/admin/firmwares/get-all-firmwares',
    adminApiKey,
  );
}

export async function prepareAdminFile(
  sourceFile: File,
  kind: AdminFileKind,
  productVersion: string,
  adminApiKey: string,
): Promise<PreparedAdminFile> {
  const requestedVersion = productVersion.trim();
  if (!sourceFile.size) {
    throw new Error('The selected file is empty.');
  }
  if (!/^[\x20-\x7e]{1,8}$/.test(requestedVersion)) {
    throw new Error('Product version must contain 1 to 8 ASCII characters.');
  }

  const response = await fetch('/api/admin/files/prepare', {
    method: 'POST',
    headers: {
      ...getAdminHeaders(adminApiKey),
      'Content-Type': 'application/octet-stream',
      'x-file-kind': kind,
      'x-product-version': requestedVersion,
    },
    body: sourceFile,
  });

  if (!response.ok) {
    const responseText = await response.text();
    let message = `File preparation failed with HTTP ${response.status}.`;
    try {
      const result: unknown = JSON.parse(responseText);
      if (
        typeof result === 'object' &&
        result !== null &&
        'error' in result &&
        typeof result.error === 'string'
      ) {
        message = result.error;
      }
    } catch {
      // Retain the HTTP status when the backend response is not JSON.
    }
    throw new Error(message);
  }

  const responseVersion = response.headers.get('x-product-version');
  const responseKind = response.headers.get('x-file-kind');
  const responseHash = response.headers.get('x-sha256');
  const contentLength = response.headers.get('content-length');
  if (
    responseKind !== kind ||
    responseVersion !== requestedVersion ||
    responseHash === null ||
    !/^[a-fA-F0-9]{64}$/.test(responseHash) ||
    contentLength === null
  ) {
    throw new Error('Prepared file response metadata is missing or invalid.');
  }

  const preparedBytes = new Uint8Array(await response.arrayBuffer());
  const setupPrefixLength =
    kind === 'setup' ? 1 + requestedVersion.length : 0;
  if (sourceFile.size <= setupPrefixLength) {
    throw new Error('The selected file is too short for the requested file type.');
  }
  const expectedSize = sourceFile.size - setupPrefixLength + 8 + 32;
  if (
    preparedBytes.length !== expectedSize ||
    Number(contentLength) !== expectedSize
  ) {
    throw new Error('Prepared file size does not match the expected file size.');
  }

  const versionBytes = preparedBytes.subarray(0, 8);
  const embeddedVersion = new TextDecoder('ascii')
    .decode(versionBytes)
    .replace(/[ \0]+$/g, '');
  if (embeddedVersion !== requestedVersion) {
    throw new Error('Prepared file contains an unexpected product version.');
  }

  const contentLengthWithoutHash = preparedBytes.length - 32;
  const content = new Uint8Array(contentLengthWithoutHash);
  content.set(preparedBytes.subarray(0, contentLengthWithoutHash));
  const calculatedHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const embeddedHash = Array.from(
    preparedBytes.subarray(contentLengthWithoutHash),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

  if (
    calculatedHash.toLowerCase() !== embeddedHash.toLowerCase() ||
    calculatedHash.toLowerCase() !== responseHash.toLowerCase()
  ) {
    throw new Error('Prepared file SHA-256 verification failed.');
  }

  const baseName = sourceFile.name.replace(/\.[^.]+$/, '');
  const file = new File(
    [preparedBytes],
    `${baseName}-prepared.bin`,
    { type: 'application/octet-stream' },
  );

  return {
    kind,
    file,
    productVersion: requestedVersion,
    sha256: calculatedHash,
    size: preparedBytes.length,
  };
}

export async function savePreparedFileLocally(file: File): Promise<boolean> {
  const saveWindow = window as WindowWithSaveFilePicker;
  if (saveWindow.showSaveFilePicker) {
    const handle = await saveWindow.showSaveFilePicker({
      suggestedName: file.name,
      types: [
        {
          description: 'Prepared binary file',
          accept: { 'application/octet-stream': ['.bin'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return true;
  }

  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return false;
}

export async function uploadFirmwareFile(
  file: File,
  adminApiKey: string,
): Promise<FileUploadResponse> {
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }

  const fileName = file.name.replace(/[^\x20-\x7E]/g, '_');
  const response = await fetch('/api/admin/firmwares/create', {
    method: 'POST',
    headers: {
      ...getAdminHeaders(adminApiKey),
      'Content-Type': 'application/octet-stream',
      'x-file-name': fileName,
    },
    body: file,
  });
  const result = await readJsonResponse(response);

  if (response.status !== 201) {
    throw new Error(`Upload failed with HTTP ${response.status}.`);
  }
  if (!isFileUploadResponse(result)) {
    throw new Error('The backend upload response has an unexpected format.');
  }

  return result;
}
