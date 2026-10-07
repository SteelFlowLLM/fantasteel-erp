'use client';

// 서버 모드 로그인: 사원번호·비밀번호 (REQ-AUTH-001, API-152). 계정 잠김·비밀번호 재설정은 두지 않는다 (SPEC 5장 결정 4).
// 이미 로그인된 브라우저에서 새 탭을 열면 쿠키의 사원으로 바로 들어간다. 직접 나갔거나 세션이 끊긴 뒤에는 다시 입력한다.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { sessionApi } from '@/api/session';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { useLogin } from '@/hooks/useAccounts';
import { useSessionStore } from '@/stores/useSessionStore';
import { errorMessageOf } from '@/stores/useToastStore';

export function LoginForm() {
  const id = useId();
  const [employeeNo, setEmployeeNo] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useSessionStore((state) => state.signIn);
  const signedOut = useSessionStore((state) => state.signedOut);
  const login = useLogin();
  const ready = employeeNo.trim() !== '' && password !== '';

  useEffect(() => {
    if (signedOut) return;
    let alive = true;
    sessionApi.current().then(
      (account) => {
        if (alive && account) signIn(account);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [signedOut, signIn]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) login.mutate({ employeeNo: employeeNo.trim(), password });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <Field label="사원번호" htmlFor={`${id}-no`} required>
        <Input id={`${id}-no`} value={employeeNo} inputMode="numeric" autoComplete="username" autoFocus onChange={(event) => setEmployeeNo(event.target.value)} />
      </Field>
      <Field label="비밀번호" htmlFor={`${id}-pw`} required>
        <Input id={`${id}-pw`} type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
      </Field>
      <Button type="submit" variant="primary" size="lg" disabled={!ready || login.isPending}>
        {login.isPending ? '로그인하는 중…' : '로그인'}
      </Button>
      {login.error ? (
        <span role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <Icon name="alert" size="sm" />
          {errorMessageOf(login.error)}
        </span>
      ) : null}
    </form>
  );
}
