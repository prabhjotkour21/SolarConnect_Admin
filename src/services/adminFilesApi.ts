export interface AdminFileRecord {
  productVersion: string;
  firmwareVersion?: string;
  setupVersion?: string;
  sha256: string;
  size: number;
  createdAt: string;
  fileName: string;
}

export interface FileUploadResponse {
  productVersion: string;
  firmwareVersion?: string;
  setupVersion?: string;
  sha256: string;
}

export type AdminFileKind = 'setup' | 'firmware';

export interface PreparedAdminFile {
  kind: AdminFileKind;
  file: File;
  productVersion: string;
  firmwareVersion?: string;
  setupVersion?: string;
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
    (!('firmwareVersion' in value) ||
      (typeof value.firmwareVersion === 'string' &&
        /^[\x20-\x7e]{8}$/.test(value.firmwareVersion) &&
        value.firmwareVersion.trim().length > 0)) &&
    (!('setupVersion' in value) ||
      (typeof value.setupVersion === 'string' &&
        /^[\x20-\x7e]{8}$/.test(value.setupVersion))) &&
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
    (!('firmwareVersion' in value) ||
      (typeof value.firmwareVersion === 'string' &&
        /^[\x20-\x7e]{8}$/.test(value.firmwareVersion) &&
        value.firmwareVersion.trim().length > 0)) &&
    (!('setupVersion' in value) ||
      (typeof value.setupVersion === 'string' &&
        /^[\x20-\x7e]{8}$/.test(value.setupVersion))) &&
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

function getAdminHeaders(adminApiKey: string): Record<string, string> {
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
  adminApiKey: string,
  productVersion?: string,
): Promise<PreparedAdminFile> {
  const requestedVersion = productVersion?.trim();
  if (!sourceFile.size) {
    throw new Error('The selected file is empty.');
  }
  if (
    kind === 'firmware' &&
    (!requestedVersion || !/^[\x20-\x7e]{1,8}$/.test(requestedVersion))
  ) {
    throw new Error('Product version must contain 1 to 8 ASCII characters.');
  }

  const headers: Record<string, string> = {
    ...getAdminHeaders(adminApiKey),
    'Content-Type': 'application/octet-stream',
    'x-file-kind': kind,
  };
  if (kind === 'firmware' && requestedVersion) {
    headers['x-product-version'] = requestedVersion;
  }
  const response = await fetch('/api/admin/files/prepare', {
    method: 'POST',
    headers,
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
  const responseFirmwareVersion = response.headers.get('x-firmware-version');
  const responseSetupVersion = response.headers.get('x-setup-version');
  const responseKind = response.headers.get('x-file-kind');
  const responseHash = response.headers.get('x-sha256');
  const contentLength = response.headers.get('content-length');
  if (
    responseKind !== kind ||
    responseVersion === null ||
    (kind === 'firmware' && responseVersion !== requestedVersion) ||
    (kind === 'setup' &&
      (responseSetupVersion === null ||
        !/^[\x20-\x7e]{8}$/.test(responseSetupVersion))) ||
    (kind === 'firmware' &&
      (responseSetupVersion !== null ||
        responseFirmwareVersion === null ||
        !/^[\x20-\x7e]{8}$/.test(responseFirmwareVersion) ||
        responseFirmwareVersion.trim().length === 0)) ||
    (kind === 'setup' && responseFirmwareVersion !== null) ||
    responseHash === null ||
    !/^[a-fA-F0-9]{64}$/.test(responseHash) ||
    contentLength === null
  ) {
    throw new Error('Prepared file response metadata is missing or invalid.');
  }

  const preparedBytes = new Uint8Array(await response.arrayBuffer());
  const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
  const expectedSize = sourceBytes.length + 32;
  if (
    preparedBytes.length !== expectedSize ||
    Number(contentLength) !== expectedSize
  ) {
    throw new Error('Prepared file size does not match the expected file size.');
  }

  let detectedProductVersion: string;
  let detectedFirmwareVersion: string | undefined;
  let detectedSetupVersion: string | undefined;
  if (kind === 'setup') {
    const setupVersionBytes = sourceBytes.subarray(0, 8);
    if (
      setupVersionBytes.length !== 8 ||
      setupVersionBytes.some((byte) => byte < 0x20 || byte > 0x7e)
    ) {
      throw new Error('Selected Setup file must start with an 8-character ASCII Setup version.');
    }
    detectedSetupVersion = String.fromCharCode(...setupVersionBytes);
    if (responseSetupVersion !== detectedSetupVersion) {
      throw new Error('Prepared file Setup version does not match the selected file.');
    }

    const productVersionLength = sourceBytes[8];
    if (
      productVersionLength === undefined ||
      productVersionLength < 1 ||
      productVersionLength > 8 ||
      sourceBytes.length < 9 + productVersionLength
    ) {
      throw new Error('Selected Setup file contains an invalid product version.');
    }
    const productVersionBytes = sourceBytes.subarray(
      9,
      9 + productVersionLength,
    );
    if (productVersionBytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
      throw new Error('Selected Setup file contains an invalid product version.');
    }
    detectedProductVersion = String.fromCharCode(...productVersionBytes);
    if (responseVersion !== detectedProductVersion) {
      throw new Error('Prepared file product version does not match the selected file.');
    }

    if (
      sourceBytes.some((byte, index) => preparedBytes[index] !== byte)
    ) {
      throw new Error('Preparation changed the selected Setup file bytes.');
    }
  } else {
    if (!requestedVersion) {
      throw new Error('Product version is required to prepare firmware.');
    }
    detectedProductVersion = requestedVersion;
    const firmwareVersionBytes = sourceBytes.subarray(0, 8);
    if (
      firmwareVersionBytes.length !== 8 ||
      firmwareVersionBytes.some((byte) => byte < 0x20 || byte > 0x7e) ||
      String.fromCharCode(...firmwareVersionBytes).trim().length === 0
    ) {
      throw new Error('Selected firmware file must start with an 8-character ASCII firmware version.');
    }
    detectedFirmwareVersion = String.fromCharCode(...firmwareVersionBytes);
    if (
      responseFirmwareVersion !== detectedFirmwareVersion ||
      responseVersion !== detectedProductVersion
    ) {
      throw new Error('Prepared file firmware or product version does not match the selected file.');
    }
    if (
      sourceBytes.some((byte, index) => preparedBytes[index] !== byte)
    ) {
      throw new Error('Preparation changed the selected firmware file bytes.');
    }
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
    productVersion: detectedProductVersion,
    ...(detectedFirmwareVersion ? { firmwareVersion: detectedFirmwareVersion } : {}),
    ...(detectedSetupVersion ? { setupVersion: detectedSetupVersion } : {}),
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
  productVersion: string,
): Promise<FileUploadResponse> {
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }

  const fileName = file.name.replace(/[^\x20-\x7E]/g, '_');
  const requestedVersion = productVersion.trim();
  if (!/^[\x20-\x7e]{1,8}$/.test(requestedVersion)) {
    throw new Error('Product version must contain 1 to 8 ASCII characters.');
  }
  const response = await fetch('/api/admin/firmwares/create', {
    method: 'POST',
    headers: {
      ...getAdminHeaders(adminApiKey),
      'Content-Type': 'application/octet-stream',
      'x-file-name': fileName,
      'x-product-version': requestedVersion,
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
  if (
    result.productVersion !== requestedVersion ||
    typeof result.firmwareVersion !== 'string'
  ) {
    throw new Error('The backend did not confirm the uploaded firmware and product versions.');
  }

  return result;
}
