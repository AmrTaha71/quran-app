import test from 'node:test';
import assert from 'node:assert/strict';
import { authErrorAr } from './authErrors.ts';

test('known Supabase messages become Arabic', () => {
  assert.match(authErrorAr('Invalid login credentials'), /مش صح/);
  assert.match(authErrorAr('Email not confirmed'), /أكدت/);
  assert.match(authErrorAr('User already registered'), /موجود/);
  assert.match(authErrorAr('Email rate limit exceeded'), /استنى/);
  assert.match(authErrorAr('Password should be at least 6 characters'), /٦/);
  assert.match(authErrorAr('Auth session missing!'), /خلصت/);
});

test('unknown English never reaches the user; Arabic passes through', () => {
  assert.doesNotMatch(authErrorAr('Something odd happened'), /[A-Za-z]/);
  assert.equal(authErrorAr('رسالة عربية'), 'رسالة عربية');
  assert.doesNotMatch(authErrorAr(''), /[A-Za-z]/);
});
