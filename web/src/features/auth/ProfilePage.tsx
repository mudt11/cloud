import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../../shared/api/client';
import type { User } from '../../shared/api/contracts';
import { normalizeDisplayName, validateUserField } from '../../shared/api/user-validation';
import { useRetryAfter } from '../../shared/api/useRetryAfter';
import { useSession } from '../../shared/session/SessionProvider';
import { FormField } from '../../shared/ui/FormField';
import { PageState } from '../../shared/ui/PageState';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import { getProfile, saveDisplayName } from './auth-api';

export function ProfilePage() {
  const { session, updateUser } = useSession();
  const accessToken = session?.accessToken;
  const [profile, setProfile] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [loadProblem, setLoadProblem] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [fieldError, setFieldError] = useState<string>();
  const [saveProblem, setSaveProblem] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const retry = useRetryAfter();

  useEffect(() => {
    if (!accessToken) return;
    let active = true;

    getProfile(accessToken).then(
      (user) => {
        if (!active) return;
        setProfile(user);
        setDisplayName(user.displayName);
      },
      (error: unknown) => {
        if (!active) return;
        setLoadProblem(error instanceof ApiError ? error.message : 'Không tải được hồ sơ.');
      },
    );

    return () => { active = false; };
  }, [accessToken, loadAttempt]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !profile || saving || retry.seconds) return;

    const validationMessage = validateUserField('displayName', displayName, 'profile');
    setFieldError(validationMessage);
    setSaveProblem('');
    setSaved(false);
    if (validationMessage || normalizeDisplayName(displayName) === profile.displayName) return;

    setSaving(true);
    try {
      const updated = await saveDisplayName(accessToken, displayName);
      setProfile(updated);
      setDisplayName(updated.displayName);
      updateUser(updated);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError) {
        const serverMessage = error.details.find((detail) => detail.field === 'displayName')?.message;
        if (error.retryAfterSeconds) retry.start(error.retryAfterSeconds);
        if (serverMessage) setFieldError(serverMessage);
        else setSaveProblem(error.message);
      } else {
        setSaveProblem('Không lưu được thay đổi. Vui lòng thử lại.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="profile-view">
      <h1>Hồ sơ cá nhân</h1>
      <p className="page-description">Quản lý tên hiển thị và xem thông tin đăng nhập.</p>

      {loadProblem ? (
        <PageState
          variant="error"
          title="Không tải được hồ sơ"
          description={loadProblem}
          action={<button className="secondary-button" type="button" onClick={() => {
            setLoadProblem('');
            setLoadAttempt((attempt) => attempt + 1);
          }}>Thử lại</button>}
        />
      ) : !profile ? (
        <PageState variant="loading" title="Đang tải hồ sơ" />
      ) : (
        <div className="profile-card">
          <dl className="profile-details">
            <div><dt>Email</dt><dd>{profile.email}</dd></div>
            <div><dt>Vai trò</dt><dd>{profile.role === 'ADMIN' ? 'Quản trị viên' : 'Khách hàng'}</dd></div>
            <div><dt>Mã người dùng</dt><dd>{profile.id}</dd></div>
          </dl>
          <form className="profile-form" onSubmit={handleSave} noValidate aria-busy={saving}>
            {saved && <RequestNotice tone="success">Đã lưu tên hiển thị.</RequestNotice>}
            {saveProblem && <RequestNotice tone="error">{saveProblem}</RequestNotice>}
            <FormField
              label="Tên hiển thị"
              name="displayName"
              autoComplete="name"
              value={displayName}
              hint="Tên chủ tài khoản VND vẫn theo thông tin đã ghi nhận khi mở tài khoản."
              error={fieldError}
              readOnly={saving}
              required
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (fieldError) setFieldError(validateUserField('displayName', event.target.value, 'profile'));
                setSaved(false);
              }}
            />
            <button
              className="primary-link"
              type="submit"
              disabled={saving || retry.seconds > 0 || normalizeDisplayName(displayName) === profile.displayName}
            >
              {saving ? 'Đang lưu…' : retry.seconds ? 'Thử lại sau ' + retry.seconds + ' giây' : 'Lưu thay đổi'}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
