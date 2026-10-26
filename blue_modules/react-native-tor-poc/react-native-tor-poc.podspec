require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'react-native-tor-poc'
  s.version      = package['version']
  s.summary      = 'Throwaway POC: embedded C-Tor (Tor.framework) SOCKS bridge for the Tor-for-Vaults spike'
  s.description  = 'Starts an embedded Tor client and reports the local SOCKS port + bootstrap progress to JS. POC only.'
  s.homepage     = 'https://cypherbox.io'
  s.license      = 'MIT'
  s.author       = { 'CypherBox' => 'info@cypherbox.io' }
  s.platforms    = { :ios => '15.1' }
  s.source       = { :path => '.' }

  s.source_files = 'ios/**/*.{h,m,mm}'

  # The thing we are validating: precompiled embedded Tor.
  s.dependency 'Tor', '~> 409'
  s.dependency 'React-Core'
end
