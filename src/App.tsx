import { useState, type ChangeEvent, type FormEvent } from 'react';
import './App.css';
import { uploadSetupFile } from './services/setupFileApi';
import {
  getAllFirmwareFiles,
  getAllSetupFiles,
  prepareAdminFile,
  savePreparedFileLocally,
  uploadFirmwareFile,
  type AdminFileRecord,
  type PreparedAdminFile,
} from './services/adminFilesApi';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

type AdminPage =
  | 'setup-upload'
  | 'setup-list'
  | 'firmware-upload'
  | 'firmware-list';

const adminPages: { id: AdminPage; label: string }[] = [
  { id: 'setup-upload', label: 'Setup file add / update' },
  { id: 'setup-list', label: 'Get all setup files' },
  { id: 'firmware-upload', label: 'Firmware file add / update' },
  { id: 'firmware-list', label: 'Get all firmware files' },
];

function HoverText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);

  return (
    <span className="hover-text">
      {parts.map((part, index) =>
        /^\s+$/.test(part) ? (
          part
        ) : (
          <span className="hover-word" key={`${part}-${index}`}>
            {part}
          </span>
        ),
      )}
    </span>
  );
}

function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [activePage, setActivePage] = useState<AdminPage>('setup-upload');
  const [file, setFile] = useState<File | null>(null);
  const [productVersion, setProductVersion] = useState('');
  const [preparedFile, setPreparedFile] = useState<PreparedAdminFile | null>(null);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [isSavingPreparedFile, setIsSavingPreparedFile] = useState(false);
  const [isPreparedFileSaved, setIsPreparedFileSaved] = useState(false);
  const [needsSaveConfirmation, setNeedsSaveConfirmation] = useState(false);
  const [prepareMessage, setPrepareMessage] = useState('');
  const [prepareMessageType, setPrepareMessageType] = useState<
    'success' | 'error' | 'info'
  >('info');
  const [adminApiKey, setAdminApiKey] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [fileRecords, setFileRecords] = useState<AdminFileRecord[] | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState('');

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (username.trim() !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      setLoginError('The username or password is incorrect.');
      return;
    }

    setLoginError('');
    setPassword('');
    setIsLoggedIn(true);
  }

  function handleLogout() {
    setIsLoggedIn(false);
    setUsername('');
    setPassword('');
    setAdminApiKey('');
    setFile(null);
    setProductVersion('');
    setPreparedFile(null);
    setIsPreparedFileSaved(false);
    setNeedsSaveConfirmation(false);
    setPrepareMessage('');
    setMessage('');
    setFileRecords(null);
    setActivePage('setup-upload');
    setIsPasswordVisible(false);
  }

  function handlePageChange(page: AdminPage) {
    setActivePage(page);
    setFile(null);
    setProductVersion('');
    setPreparedFile(null);
    setIsPreparedFileSaved(false);
    setNeedsSaveConfirmation(false);
    setPrepareMessage('');
    setMessage('');
    setFileRecords(null);
    setListError('');
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreparedFile(null);
    setIsPreparedFileSaved(false);
    setNeedsSaveConfirmation(false);
    setPrepareMessage('');
    setMessage('');
  }

  async function handlePrepareFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setPrepareMessageType('error');
      setPrepareMessage('Select a file to prepare first.');
      return;
    }

    setIsPreparingFile(true);
    setPreparedFile(null);
    setIsPreparedFileSaved(false);
    setNeedsSaveConfirmation(false);
    setPrepareMessageType('info');
    setPrepareMessage('Preparing file and calculating SHA-256...');
    try {
      const prepared = await prepareAdminFile(
        file,
        activePage === 'setup-upload' ? 'setup' : 'firmware',
        productVersion,
        adminApiKey,
      );
      setPreparedFile(prepared);
      setPrepareMessage(
        'SHA-256 was added and verified. Save the prepared file locally to enable the upload section.',
      );
    } catch (error) {
      setPrepareMessageType('error');
      setPrepareMessage(
        error instanceof Error ? error.message : 'File preparation failed.',
      );
    } finally {
      setIsPreparingFile(false);
    }
  }

  async function handleSavePreparedFile() {
    if (!preparedFile || isSavingPreparedFile) return;

    setIsSavingPreparedFile(true);
    setPrepareMessageType('info');
    try {
      const saved = await savePreparedFileLocally(preparedFile.file);
      setNeedsSaveConfirmation(!saved);
      setIsPreparedFileSaved(saved);
      setPrepareMessageType(saved ? 'success' : 'info');
      setPrepareMessage(
        saved
          ? `Prepared file saved on this computer as ${preparedFile.file.name}. The original file was not changed.`
          : `A download was started for ${preparedFile.file.name}. Confirm below after you save it locally.`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setPrepareMessageType('info');
        setPrepareMessage('Save cancelled. Save the prepared file to enable upload.');
      } else {
        setPrepareMessageType('error');
        setPrepareMessage(
          error instanceof Error ? error.message : 'Could not save the prepared file.',
        );
      }
    } finally {
      setIsSavingPreparedFile(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!preparedFile || !isPreparedFileSaved) {
      setMessageType('error');
      setMessage('Prepare and save the file locally before uploading.');
      return;
    }

    setIsUploading(true);
    setMessageType('info');
    setMessage('Uploading file and waiting for backend validation...');
    try {
      const result =
        activePage === 'firmware-upload'
          ? await uploadFirmwareFile(preparedFile.file, adminApiKey)
          : await uploadSetupFile(preparedFile.file, adminApiKey);
      setMessageType('success');
      setMessage(
        `Upload successful. Product version: ${result.productVersion}. SHA-256: ${result.sha256}`,
      );
    } catch (error) {
      setMessageType('error');
      setMessage(
        error instanceof Error ? error.message : 'The setup file upload failed.',
      );
    } finally {
      setIsUploading(false);
    }
  }
  async function handleLoadFiles() {
    setIsLoadingList(true);
    setListError('');
    setFileRecords(null);

    try {
      const records =
        activePage === 'setup-list'
          ? await getAllSetupFiles(adminApiKey)
          : await getAllFirmwareFiles(adminApiKey);
      setFileRecords(records);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : 'Could not load the file list.',
      );
    } finally {
      setIsLoadingList(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <main className="admin-page" key="login">
        <header className="page-header">
          <p className="eyebrow">
            <HoverText text="SOLARCONNECT ADMIN" />
          </p>
          <h1>
            <HoverText text="Admin sign in" />
          </h1>
          <p className="subtitle">
            <HoverText text="Sign in to manage files." />
          </p>
        </header>

        <section className="login-card">
          <h2>
            <HoverText text="Welcome back" />
          </h2>
          <p className="help-text">
            <HoverText text="Enter your admin username and password to continue." />
          </p>

          <form className="login-form" onSubmit={handleLogin}>
            <label className="login-field">
              <span>
                <HoverText text="Username" />
              </span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter username"
                required
              />
            </label>

            <label className="login-field">
              <span>
                <HoverText text="Password" />
              </span>
              <span className="password-input-wrap">
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  required
                />
                <button
                  className="password-visibility-button"
                  type="button"
                  aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={isPasswordVisible}
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {isPasswordVisible ? (
                      <>
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                        <path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.3 4.1 9.5 6-.4.7-1.2 1.8-2.4 2.9" />
                        <path d="M6.2 6.2C4.3 7.4 3 9.2 2.5 11c1.2 1.9 4.5 6 9.5 6 1 0 2-.2 2.9-.5" />
                      </>
                    ) : (
                      <>
                        <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </>
                    )}
                  </svg>
                </button>
              </span>
            </label>

            <button className="upload-button" type="submit">
              <HoverText text="Sign in" />
            </button>

            {loginError && (
              <p className="form-message error" role="alert">
                <HoverText text={loginError} />
              </p>
            )}
          </form>
        </section>
      </main>
    );
  }

  const pageDetails: Record<
    AdminPage,
    { title: string; heading: string; description: string }
  > = {
    'setup-upload': {
      title: 'Setup files',
      heading: 'Add or update setup',
      description: 'Select the setup file you want to upload.',
    },
    'setup-list': {
      title: 'Setup files',
      heading: 'All setup files',
      description: 'View setup files that have been uploaded.',
    },
    'firmware-upload': {
      title: 'Firmware files',
      heading: 'Add or update firmware',
      description: 'Select the firmware file you want to upload.',
    },
    'firmware-list': {
      title: 'Firmware files',
      heading: 'All firmware files',
      description: 'View firmware files that have been uploaded.',
    },
  };
  const currentPage = pageDetails[activePage];
  const isListPage = activePage === 'setup-list' || activePage === 'firmware-list';

  return (
    <main className="admin-layout" key="admin">
      <div className="admin-content">
        <header className="page-header">
          <p className="eyebrow">
            <HoverText text="SOLARCONNECT ADMIN" />
          </p>
          <h1>
            <HoverText text={currentPage.title} />
          </h1>
          <p className="subtitle">
            <HoverText text={currentPage.description} />
          </p>
        </header>

        {isListPage ? (
          <section className="upload-card">
            <h2>
              <HoverText text={currentPage.heading} />
            </h2>
            <div className="list-toolbar">
              <p className="help-text">
                <HoverText
                  text={
                    adminApiKey.trim()
                      ? 'Load the latest file metadata from the backend.'
                      : 'Enter the Admin API key in the right menu to load files.'
                  }
                />
              </p>
              <button
                className="upload-button"
                type="button"
                onClick={handleLoadFiles}
                disabled={!adminApiKey.trim() || isLoadingList}
              >
                <HoverText text={isLoadingList ? 'Loading...' : 'Load files'} />
              </button>
            </div>

            {listError && (
              <p className="form-message error" role="alert">
                <HoverText text={listError} />
              </p>
            )}

            {fileRecords && (
              fileRecords.length === 0 ? (
                <p className="empty-file-list">No files have been uploaded yet.</p>
              ) : (
                <div className="file-list-scroll">
                  <table className="file-list">
                    <thead>
                      <tr>
                        <th>File name</th>
                        <th>Product version</th>
                        <th>Size</th>
                        <th>SHA-256</th>
                        <th>Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileRecords.map((record, index) => (
                        <tr key={`${record.productVersion}-${record.createdAt}-${index}`}>
                          <td>{record.fileName}</td>
                          <td>{record.productVersion}</td>
                          <td>{(record.size / 1024).toFixed(1)} KB</td>
                          <td className="hash-cell">{record.sha256}</td>
                          <td>{new Date(record.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </section>
        ) : (
          <>
            <section className="upload-card prepare-card">
              <h2>
                <HoverText
                  text={
                    activePage === 'setup-upload'
                      ? 'Prepare setup file'
                      : 'Prepare firmware file'
                  }
                />
              </h2>
              <p className="help-text">
                <HoverText
                  text={
                    activePage === 'setup-upload'
                      ? 'Choose the original AppSetup.bin. Its embedded product version must match the value below.'
                      : 'Choose the raw firmware image without a product-version prefix or SHA-256 footer.'
                  }
                />
              </p>

              <form onSubmit={handlePrepareFile}>
                <label className="login-field">
                  <span>
                    <HoverText text="Product version" />
                  </span>
                  <input
                    type="text"
                    value={productVersion}
                    onChange={(event) => {
                      setProductVersion(event.target.value);
                      setPreparedFile(null);
                      setIsPreparedFileSaved(false);
                      setNeedsSaveConfirmation(false);
                      setPrepareMessage('');
                    }}
                    placeholder="For example, INV3P001"
                    maxLength={8}
                    required
                    disabled={isPreparingFile || isUploading}
                  />
                </label>

                <label className="file-picker">
                  <span className="file-picker-title">
                    <HoverText text="Select the original file" />
                  </span>
                  <input
                    key={activePage}
                    type="file"
                    accept={activePage === 'setup-upload' ? '.bin,.txt' : undefined}
                    onChange={handleFileChange}
                    disabled={isPreparingFile || isUploading}
                  />
                </label>

                {file && (
                  <div className="selected-file">
                    <span className="selected-file-mark" aria-hidden="true">✓</span>
                    <span className="selected-file-name" title={file.name}>
                      <HoverText text={file.name} />
                    </span>
                    <span className="file-size">
                      <HoverText text={`${(file.size / 1024).toFixed(1)} KB`} />
                    </span>
                  </div>
                )}

                <button
                  className="upload-button"
                  type="submit"
                  disabled={
                    !file ||
                    !productVersion.trim() ||
                    !adminApiKey.trim() ||
                    isPreparingFile ||
                    isUploading
                  }
                >
                  <HoverText
                    text={isPreparingFile ? 'Preparing...' : 'Prepare and add SHA-256'}
                  />
                </button>

                {preparedFile && (
                  <div className="prepared-file">
                    <p className="prepared-file-title">
                      Prepared and verified: {preparedFile.file.name}
                    </p>
                    <p className="prepared-file-hash">
                      SHA-256: {preparedFile.sha256}
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void handleSavePreparedFile()}
                      disabled={isSavingPreparedFile || isPreparedFileSaved}
                    >
                      {isSavingPreparedFile
                        ? 'Saving...'
                        : isPreparedFileSaved
                          ? 'Saved on this computer'
                          : 'Save prepared file locally'}
                    </button>
                    {needsSaveConfirmation && (
                      <label className="save-confirmation">
                        <input
                          type="checkbox"
                          checked={isPreparedFileSaved}
                          onChange={(event) => {
                            setIsPreparedFileSaved(event.target.checked);
                            setPrepareMessageType(
                              event.target.checked ? 'success' : 'info',
                            );
                            setPrepareMessage(
                              event.target.checked
                                ? 'Local save confirmed. The upload section is enabled.'
                                : 'Confirm the local save to enable the upload section.',
                            );
                          }}
                        />
                        <span>
                          I saved the downloaded prepared file on this computer.
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {prepareMessage && (
                  <p className={`form-message ${prepareMessageType}`} role="status">
                    <HoverText text={prepareMessage} />
                  </p>
                )}
              </form>
            </section>

            <section
              className={`upload-card final-upload-card${!isPreparedFileSaved ? ' locked' : ''}`}
              aria-disabled={!isPreparedFileSaved}
            >
              <h2>
                <HoverText text={currentPage.heading} />
              </h2>
              <p className="help-text">
                <HoverText
                  text={
                    isPreparedFileSaved
                      ? 'The prepared file is ready. Uploading stores it in the backend.'
                      : 'Prepare and save the file above to enable this upload section.'
                  }
                />
              </p>

              {preparedFile && (
                <div className="selected-file">
                  <span className="selected-file-mark" aria-hidden="true">✓</span>
                  <span className="selected-file-name" title={preparedFile.file.name}>
                    <HoverText text={preparedFile.file.name} />
                  </span>
                  <span className="file-size">
                    <HoverText
                      text={`${(preparedFile.size / 1024).toFixed(1)} KB`}
                    />
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <button
                  className="upload-button"
                  type="submit"
                  disabled={
                    !isPreparedFileSaved ||
                    !adminApiKey.trim() ||
                    isUploading
                  }
                >
                  <HoverText text={isUploading ? 'Uploading...' : 'Upload file'} />
                </button>

                {message && (
                  <p className={`form-message ${messageType}`} role="status">
                    <HoverText text={message} />
                  </p>
                )}
              </form>
            </section>
          </>
        )}
      </div>

      <aside className="admin-sidebar" aria-label="Admin menu">
        <h2 className="sidebar-heading">Admin menu</h2>
        <nav className="admin-nav" aria-label="File management">
          {adminPages.map((page, index) => (
            <button
              key={page.id}
              className={`admin-nav-button${activePage === page.id ? ' active' : ''}`}
              type="button"
              aria-current={activePage === page.id ? 'page' : undefined}
              onClick={() => handlePageChange(page.id)}
            >
              <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
              <span>{page.label}</span>
            </button>
          ))}
        </nav>

        <label className="sidebar-key-picker">
          <span>Admin API key</span>
          <input
            type="password"
            autoComplete="off"
            value={adminApiKey}
            onChange={(event) => setAdminApiKey(event.target.value)}
            placeholder="Enter API key"
          />
          <span className="input-hint">
            Required for preparation and final upload requests.
          </span>
        </label>

        <button className="sidebar-logout" type="button" onClick={handleLogout}>
          <HoverText text="Sign out" />
        </button>
      </aside>
    </main>
  );
}

export default App;