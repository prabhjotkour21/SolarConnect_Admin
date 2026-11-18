export interface SetupFileUploadResponse {
  productVersion: string;
  sha256: string;
}

function isUploadResponse(value: unknown): value is SetupFileUploadResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'productVersion' in value &&
    typeof value.productVersion === 'string' &&
    'sha256' in value &&
    typeof value.sha256 === 'string'
  );
}

export async function uploadSetupFile(
  file: File,
  adminApiKey: string,
): Promise<SetupFileUploadResponse> {
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }
  if (!adminApiKey.trim()) {
    throw new Error('Enter the admin API key.');
  }

  const fileName = file.name.replace(/[^\x20-\x7E]/g, '_');
  const response = await fetch('/api/admin/setup-files/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-admin-api-key': adminApiKey.trim(),
      'x-file-name': fileName,
    },
    body: file,
  });

  const responseText = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      response.ok
        ? 'The backend returned an invalid response.'
        : `Upload failed with HTTP ${response.status}.`,
    );
  }

  if (response.status !== 201) {
    const message =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : `Upload failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (!isUploadResponse(result)) {
    throw new Error('The backend upload response has an unexpected format.');
  }

  return result;
}