const {
  nameFromProfile,
  resolveUserIdentity,
  profileRepairPayload,
} = require('../../shared/userIdentity');

// Artificial names and emails only.
describe('nameFromProfile — every field name this project has written', () => {
  it('prefers `name`, then fullName, then displayName', () => {
    expect(nameFromProfile({ name: 'A One', fullName: 'B Two', displayName: 'C Three' })).toBe('A One');
    expect(nameFromProfile({ fullName: 'B Two', displayName: 'C Three' })).toBe('B Two');
    expect(nameFromProfile({ displayName: 'C Three' })).toBe('C Three');
  });

  it('composes firstName/lastName and tolerates either half being absent', () => {
    expect(nameFromProfile({ firstName: 'Ann', lastName: 'Adams' })).toBe('Ann Adams');
    expect(nameFromProfile({ firstName: 'Ann' })).toBe('Ann');
    expect(nameFromProfile({ lastName: 'Adams' })).toBe('Adams');
  });

  it('treats blank, whitespace and non-string values as absent', () => {
    expect(nameFromProfile({ name: '   ' })).toBeNull();
    expect(nameFromProfile({ name: 42 })).toBeNull();
    expect(nameFromProfile({})).toBeNull();
    expect(nameFromProfile(null)).toBeNull();
  });

  it('trims stored whitespace', () => {
    expect(nameFromProfile({ name: '  Ann Adams  ' })).toBe('Ann Adams');
  });
});

describe('resolveUserIdentity — Auth is the fallback, never "Unknown"', () => {
  const authUser = { displayName: 'Auth Name', email: 'auth@example.test' };

  it('uses the profile when it is complete and reports both sources as profile', () => {
    const id = resolveUserIdentity({ name: 'Profile Name', email: 'profile@example.test' }, authUser);
    expect(id).toEqual({
      name: 'Profile Name',
      email: 'profile@example.test',
      nameSource: 'profile',
      emailSource: 'profile',
    });
  });

  // THE BUG: a membership for a user who already existed in Auth had no
  // `users/{uid}` document at all, so the roster showed "Unknown / No Email".
  it('recovers name and email from Auth when the profile document is missing', () => {
    expect(resolveUserIdentity(null, authUser)).toEqual({
      name: 'Auth Name',
      email: 'auth@example.test',
      nameSource: 'auth',
      emailSource: 'auth',
    });
  });

  // onMembershipWrite merge-writes {companyIds} onto a non-existent doc, which
  // CREATES a profile carrying no name and no email.
  it('recovers identity from Auth when the profile holds only companyIds', () => {
    const id = resolveUserIdentity({ companyIds: ['co-a'] }, authUser);
    expect(id.name).toBe('Auth Name');
    expect(id.email).toBe('auth@example.test');
    expect(id.nameSource).toBe('auth');
  });

  it('mixes sources per field', () => {
    const id = resolveUserIdentity({ firstName: 'Ann', lastName: 'Adams' }, authUser);
    expect(id).toEqual({
      name: 'Ann Adams',
      email: 'auth@example.test',
      nameSource: 'profile',
      emailSource: 'auth',
    });
  });

  it('reports null identity with null sources when neither source has anything', () => {
    expect(resolveUserIdentity(null, null)).toEqual({
      name: null, email: null, nameSource: null, emailSource: null,
    });
    expect(resolveUserIdentity({ companyIds: [] }, { uid: 'u1' })).toEqual({
      name: null, email: null, nameSource: null, emailSource: null,
    });
  });
});

describe('profileRepairPayload — repairs only what came from Auth', () => {
  it('returns the Auth-recovered fields so the profile stops needing a lookup', () => {
    const id = resolveUserIdentity(null, { displayName: 'Auth Name', email: 'auth@example.test' });
    expect(profileRepairPayload(id)).toEqual({ name: 'Auth Name', email: 'auth@example.test' });
  });

  it('never overwrites a name or email the profile already stores', () => {
    const id = resolveUserIdentity(
      { name: 'Profile Name', email: 'profile@example.test' },
      { displayName: 'Auth Name', email: 'auth@example.test' },
    );
    expect(profileRepairPayload(id)).toEqual({});
  });

  it('repairs only the missing half', () => {
    const id = resolveUserIdentity({ name: 'Profile Name' }, { email: 'auth@example.test' });
    expect(profileRepairPayload(id)).toEqual({ email: 'auth@example.test' });
  });

  it('returns nothing to repair when there is no identity anywhere', () => {
    expect(profileRepairPayload(resolveUserIdentity(null, null))).toEqual({});
  });
});
