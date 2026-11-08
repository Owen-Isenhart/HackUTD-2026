# Hands-Off Banking · Nearby Offers

The iPhone app checks your location when you ask and lists demo cashback offers within 300 meters. Distances are straight-line estimates. The prototype uses a small local catalog around Richardson and UT Dallas, and the cashback rates are fictional. The app uses your coordinates on the phone for the search.

## Test on an iPhone from Windows

Use Node.js 24 and Expo Go for SDK 58. Sign in to the same free Expo account in Expo Go and the Windows CLI.

```powershell
npm.cmd ci
npx.cmd expo whoami
npm.cmd run start:phone
```

If the CLI is signed out, run `npx.cmd expo login`. If the Windows browser launcher crashes, set `$env:BROWSER = 'none'`, run `npx.cmd expo login --browser`, and paste the fresh link into your PC browser while the CLI waits.

Keep PowerShell running and scan the new terminal QR code with the iPhone Camera. If Metro was open during the dependency update, stop it with **Ctrl+C** and restart with `npm.cmd run start:phone -- --clear`.

1. Tap **Use my location** and grant **While Using the App**. The app shows the reported accuracy and any catalog matches. Live results are available near the UT Dallas Student Union or the Chipotle at 283 W Campbell Rd in Richardson. [UT Dallas dining](https://union.utdallas.edu/facilities/dining/) · [Chipotle location](https://locations.chipotle.com/tx/richardson/283-w-campbell-rd)
2. Tap **Try demo location** from anywhere. It should show Chipotle about **180 m** away and **$0.75** in example cashback on a **$15** purchase at **5%**.
3. Tap **Send test notification** and allow notifications. A local iPhone notification is scheduled for two seconds later. You can stay in the app to see the banner or go to the Home Screen after scheduling. [Expo notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)
4. Tap **Play demo call** to hear the offer and see its transcript. Turn off Silent Mode for audio. [Expo Speech](https://docs.expo.dev/versions/v58.0.0/sdk/speech/)

## Remote alerts and calls

The demo uses local notification delivery and on-device speech. Remote push for a standalone iOS app requires a signed build, APNs credentials, and a backend that sends notifications. Detecting new locations while the app is closed requires background location permission and a development build. [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) · [Expo background location](https://docs.expo.dev/versions/v58.0.0/sdk/location/#background-location-methods)

A real inbound call to the user's iPhone can be placed by a backend through a Photon voice number with a SIP-connected provider such as ElevenLabs or Retell. `npm.cmd run photon:send -- 1` remains a separate iMessage smoke test using the settings in `.env.example`. [Photon voice and messaging](https://photon.codes/blog/introducing-photon-2.0)

The optional iBeacon prototype is in `modules/merchant-beacons`, `src/useBeaconRanging.js`, and `firmware/MerchantBeacon` for later testing.

## Verification

Run `npm.cmd test` for the demo location, radius, and cashback calculations. Run `npx.cmd expo export --platform ios` to check the iOS JavaScript bundle. Use the iPhone steps above to verify location permission, the notification banner, and audio.
