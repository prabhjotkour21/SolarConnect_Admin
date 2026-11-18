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

export async function uploadFirmwareFile(
  file: File,
  adminApiKey: string,
): Promise<FileUploadResponse> {
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }

  const fileName = file.name.replace(/[^\x20-\x7E]/g, '_');
  const response = await fetch('/api/admin/firmwares', {
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
