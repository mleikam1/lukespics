import 'dart:js_interop';

@JS('window.location.href')
external JSString get _documentHref;

@JS('window.sessionStorage.getItem')
external JSString? _sessionStorageGetItem(JSString key);

@JS('window.sessionStorage.setItem')
external void _sessionStorageSetItem(JSString key, JSString value);

@JS('window.sessionStorage.removeItem')
external void _sessionStorageRemoveItem(JSString key);

Uri browserE2eDocumentUri() => Uri.parse(_documentHref.toDart);

String? browserE2eStoredAlias() =>
    _sessionStorageGetItem('lukes-picks-browser-e2e-user'.toJS)?.toDart;

bool browserE2eSessionMatches(String alias) =>
    _sessionStorageGetItem('lukes-picks-browser-e2e-signed-in'.toJS)?.toDart ==
    alias;

void browserE2eRememberSession(String alias) => _sessionStorageSetItem(
  'lukes-picks-browser-e2e-signed-in'.toJS,
  alias.toJS,
);

void browserE2eForgetSession() =>
    _sessionStorageRemoveItem('lukes-picks-browser-e2e-signed-in'.toJS);
