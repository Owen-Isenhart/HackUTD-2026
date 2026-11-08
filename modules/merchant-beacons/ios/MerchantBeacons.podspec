Pod::Spec.new do |s|
  s.name = 'MerchantBeacons'
  s.version = '0.1.0'
  s.summary = 'Foreground iBeacon ranging for the Hands-Off Banking demo'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'HackUTD team'
  s.homepage = 'https://expo.dev/modules'
  s.platform = :ios, '16.4'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreLocation'
  s.source_files = '**/*.swift'
end
