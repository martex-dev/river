# River's native layer for iOS: the client core's native interface
# (apps/mobile/core/native.ts) and its private WebView. A local pod, so its
# sources and the core bundle are picked up without editing the Xcode project.
Pod::Spec.new do |s|
  s.name = 'RiverNative'
  s.version = '1.0.0'
  s.summary = 'River client core host for iOS'
  s.homepage = 'https://github.com/martex-dev/river'
  s.license = 'AGPL-3.0-only'
  s.author = 'River contributors'
  s.source = { :path => '.' }
  s.platform = :ios, '16.0'
  s.swift_version = '5'
  s.source_files = 'Sources/**/*.swift'
  # The client core bundle, copied here by `npm run sync:ios`.
  s.resources = ['core']
  s.dependency 'Capacitor'
  s.dependency 'LibSignalClient'
  s.dependency 'SQLCipher', '4.10.0'
  s.frameworks = 'WebKit', 'CryptoKit', 'Security', 'Compression', 'UserNotifications', 'UniformTypeIdentifiers'
end
