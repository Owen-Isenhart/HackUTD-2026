import CoreLocation
import ExpoModulesCore

public final class MerchantBeaconsModule: Module {
  private var ranger: BeaconRanger?

  public func definition() -> ModuleDefinition {
    Name("MerchantBeacons")
    Events("onStatus", "onBeacons")

    AsyncFunction("start") { (uuid: String, major: UInt16) in
      guard let beaconUUID = UUID(uuidString: uuid) else { return }
      if self.ranger == nil {
        self.ranger = BeaconRanger(
          status: { [weak self] status in self?.sendEvent("onStatus", ["status": status]) },
          readings: { [weak self] readings in self?.sendEvent("onBeacons", ["beacons": readings]) }
        )
      }
      self.ranger?.start(CLBeaconIdentityConstraint(uuid: beaconUUID, major: major))
    }.runOnQueue(.main)

    AsyncFunction("stop") { () -> Void in
      self.ranger?.stop()
    }.runOnQueue(.main)

    OnDestroy { [weak self] in
      DispatchQueue.main.async { [weak self] in self?.ranger?.stop() }
    }
  }
}

private final class BeaconRanger: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let status: (String) -> Void
  private let readings: ([[String: Int]]) -> Void
  private var constraint: CLBeaconIdentityConstraint?
  private var ranging = false

  init(status: @escaping (String) -> Void, readings: @escaping ([[String: Int]]) -> Void) {
    self.status = status
    self.readings = readings
    super.init()
    manager.delegate = self
  }

  func start(_ constraint: CLBeaconIdentityConstraint) {
    stop()
    self.constraint = constraint
    if manager.authorizationStatus == .notDetermined {
      status("permission")
      manager.requestWhenInUseAuthorization()
    } else {
      updateAuthorization()
    }
  }

  func stop() {
    stopRanging()
    constraint = nil
  }

  private func stopRanging() {
    if let constraint, ranging {
      manager.stopRangingBeacons(satisfying: constraint)
    }
    ranging = false
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    updateAuthorization()
  }

  private func updateAuthorization() {
    guard let constraint else { return }
    switch manager.authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse:
      guard manager.accuracyAuthorization == .fullAccuracy else {
        stopRanging()
        status("precision")
        return
      }
      guard CLLocationManager.isRangingAvailable() else {
        stopRanging()
        status("unavailable")
        return
      }
      guard !ranging else { return }
      ranging = true
      manager.startRangingBeacons(satisfying: constraint)
      status("scanning")
    case .denied, .restricted:
      stopRanging()
      status("denied")
    case .notDetermined:
      break
    @unknown default:
      status("unavailable")
    }
  }

  func locationManager(
    _ manager: CLLocationManager,
    didRange beacons: [CLBeacon],
    satisfying beaconConstraint: CLBeaconIdentityConstraint
  ) {
    guard ranging, constraint == beaconConstraint else { return }
    readings(beacons.map { beacon in
      let zone: Int
      switch beacon.proximity {
      case .immediate: zone = 2
      case .near: zone = 1
      case .far: zone = 0
      default: zone = -1
      }
      return ["minor": beacon.minor.intValue, "zone": zone, "rssi": beacon.rssi]
    })
  }

  func locationManager(
    _ manager: CLLocationManager,
    didFailRangingFor beaconConstraint: CLBeaconIdentityConstraint,
    error: Error
  ) {
    guard constraint == beaconConstraint else { return }
    stopRanging()
    status("unavailable")
  }
}
