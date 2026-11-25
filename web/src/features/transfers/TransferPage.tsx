import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../shared/api/client';
import type { Account } from '../../shared/api/contracts';
import { useRetryAfter } from '../../shared/api/useRetryAfter';
import { verifyMockSmartPin } from '../../shared/mocks/mock-smart-pin';
import { useSession } from '../../shared/session/SessionProvider';
import { PageState } from '../../shared/ui/PageState';
import { getMyAccount } from '../accounts/account-api';
import { TransferForm } from './TransferForm';
import { TransferResult } from './TransferResult';
import { TransferReviewPanel } from './TransferReview';
import { getTransfer, submitTransfer } from './transfer-api';
import { beginTransferIntent, clearTransferIntent, readTransferIntent, recordTransferResponse } from './transfer-intent';
import type { TransferIntent, TransferReview } from './transfer-intent';

type SourceState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; account: Account }
  | { kind: 'error'; message: string };

const actionableSubmissionErrors = new Set([
  'VALIDATION_ERROR', 'SAME_ACCOUNT', 'FORBIDDEN', 'ACCOUNT_NOT_FOUND', 'RECIPIENT_NOT_FOUND', 'IDEMPOTENCY_CONFLICT',
]);

export function TransferPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const accessToken = session?.accessToken;
  const [source, setSource] = useState<SourceState>({ kind: 'loading' });
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [review, setReview] = useState<TransferReview>();
  const [reviewing, setReviewing] = useState(false);
  const [intent, setIntent] = useState(() => userId ? readTransferIntent(userId) : undefined);
  const [problem, setProblem] = useState<string>();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [automaticCheckEnded, setAutomaticCheckEnded] = useState(false);

  const submitting = useRef(false);
  const polling = useRef(false);
  const blockedUntil = useRef(0);
  const retry = useRetryAfter();

  function rememberRetry(error: ApiError) {
    if (!error.retryAfterSeconds) return;
    blockedUntil.current = Date.now() + error.retryAfterSeconds * 1_000;
    retry.start(error.retryAfterSeconds);
  }

  const rememberSourceRetry = useEffectEvent(rememberRetry);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;

    getMyAccount(accessToken).then(
      (account) => { if (active) setSource({ kind: 'ready', account }); },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'ACCOUNT_NOT_FOUND' && error.status === 404) {
          setSource({ kind: 'missing' });
          return;
        }
        if (error instanceof ApiError) rememberSourceRetry(error);
        setSource({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Vui lòng kiểm tra kết nối rồi thử lại.',
        });
      },
    );

    return () => { active = false; };
  }, [accessToken, sourceAttempt]);

  async function send(current: TransferIntent) {
    if (!userId || !accessToken || submitting.current || Date.now() < blockedUntil.current) return;

    submitting.current = true;
    setProblem(undefined);
    setSending(true);
    try {
      const result = await submitTransfer(accessToken, current.body, current.key);
      const next = recordTransferResponse(userId, current.key, result);
      if (next) setIntent(next);
    } catch (error) {
      if (error instanceof ApiError) {
        rememberRetry(error);
        if (actionableSubmissionErrors.has(error.code)) {
          clearTransferIntent(userId, current.key);
          setIntent(undefined);
          setReview(current);
          setReviewing(true);
        }
        setProblem(error.message);
      } else {
        setProblem('Chưa nhận được phản hồi. Hãy kiểm tra lại yêu cầu hiện tại.');
      }
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  async function confirm(pin: string) {
    if (!userId || !review || !accessToken) return false;
    const verified = await verifyMockSmartPin(review.source.id, pin);
    if (!verified) return false;
    if (submitting.current || readTransferIntent(userId)) return true;

    const next = beginTransferIntent(userId, review);
    setAutomaticCheckEnded(false);
    setIntent(next);
    void send(next);
    return true;
  }

  async function checkStatus() {
    if (
      !userId || !accessToken || !intent?.transfer || intent.transfer.status !== 'PENDING'
      || polling.current || Date.now() < blockedUntil.current
    ) return;

    polling.current = true;
    setChecking(true);
    try {
      const updated = await getTransfer(accessToken, intent.transfer.id);
      const next = recordTransferResponse(userId, intent.key, updated);
      if (next) {
        setIntent(next);
        setProblem(undefined);
      }
    } catch (error) {
      if (error instanceof ApiError) rememberRetry(error);
      setProblem('Chưa cập nhật được trạng thái. Bạn có thể kiểm tra lại.');
    } finally {
      polling.current = false;
      setChecking(false);
    }
  }

  const checkAutomatically = useEffectEvent(checkStatus);
  const transferId = intent?.transfer?.id;
  const status = intent?.transfer?.status;
  const receivedAt = intent?.receivedAt;

  useEffect(() => {
    if (!transferId || status !== 'PENDING' || receivedAt === undefined) return;

    let cancelled = false;
    let timer: number | undefined;

    function schedule(startTime: number) {
      const elapsed = Date.now() - startTime;
      const remaining = 60_000 - elapsed;
      if (remaining <= 0) {
        setAutomaticCheckEnded(true);
        return;
      }

      const interval = elapsed < 30_000 ? 2_000 : 5_000;
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        if (Date.now() - startTime < 60_000) await checkAutomatically();
        if (!cancelled) schedule(startTime);
      }, Math.min(interval, remaining));
    }

    schedule(receivedAt);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [receivedAt, status, transferId]);

  function reloadSource() {
    setSource({ kind: 'loading' });
    setSourceAttempt((attempt) => attempt + 1);
  }

  function newTransfer() {
    if (!intent || !userId) return;
    clearTransferIntent(userId, intent.key);
    setIntent(undefined);
    setReview(undefined);
    setReviewing(false);
    setProblem(undefined);
    reloadSource();
  }

  return (
    <section className="transfer-page">
      <header>
        <h1>Chuyển tiền nội bộ</h1>
        <p className="page-description">Chuyển tiền VND giữa các tài khoản MiniBank.</p>
      </header>

      {intent ? (
        <TransferResult
          intent={intent}
          sending={sending}
          retrySeconds={retry.seconds}
          checking={checking}
          automaticCheckEnded={automaticCheckEnded}
          problem={problem}
          onRetry={() => void send(intent)}
          onCheck={() => void checkStatus()}
          onNewTransfer={newTransfer}
        />
      ) : source.kind === 'loading' ? (
        <PageState variant="loading" title="Đang tải tài khoản nguồn" />
      ) : source.kind === 'error' ? (
        <PageState
          variant="error"
          title="Không tải được tài khoản nguồn"
          description={source.message}
          action={<button type="button" className="secondary-button" onClick={reloadSource} disabled={retry.seconds > 0}>
            {retry.seconds ? 'Thử lại sau ' + retry.seconds + ' giây' : 'Thử lại'}
          </button>}
        />
      ) : source.kind === 'missing' ? (
        <PageState
          variant="empty"
          title="Bạn cần mở tài khoản VND"
          description="Mở tài khoản ở Tổng quan để sử dụng chức năng chuyển tiền."
          action={<Link className="primary-link" to="/tong-quan">Về Tổng quan</Link>}
        />
      ) : accessToken ? (
        <>
          <ol className="transfer-steps" aria-label="Các bước chuyển tiền">
            <li aria-current={reviewing ? undefined : 'step'}><span>1</span> Nhập thông tin</li>
            <li aria-current={reviewing ? 'step' : undefined}><span>2</span> Xác nhận</li>
          </ol>
          {reviewing && review ? (
            <TransferReviewPanel
              data={review}
              error={problem}
              onEdit={() => {
                setReviewing(false);
                setProblem(undefined);
              }}
              onConfirm={confirm}
            />
          ) : (
            <TransferForm
              source={source.account}
              accessToken={accessToken}
              previous={review}
              onReview={(data) => {
                setReview(data);
                setReviewing(true);
              }}
            />
          )}
        </>
      ) : null}
    </section>
  );
}
