import { NmedaDealersNearby } from '@wivwav/web'

const dealers = [
  {
    id: 'd1',
    name: 'Meridian Mobility Vans',
    city: 'Columbus',
    state: 'OH',
    phone: '(614) 555-0142',
    website: 'https://meridianmobilityvans.com',
    qapCertified: true,
    distanceMiles: 4,
  },
  {
    id: 'd2',
    name: 'AMS Vans of Dayton',
    city: 'Dayton',
    state: 'OH',
    phone: '(937) 555-0188',
    website: 'https://amsvans.com',
    qapCertified: true,
    distanceMiles: 22,
  },
  {
    id: 'd3',
    name: 'Buckeye Adaptive Mobility',
    city: 'Springfield',
    state: 'OH',
    phone: null,
    website: null,
    qapCertified: false,
    distanceMiles: 31,
  },
  {
    id: 'd4',
    name: 'Ohio Valley Wheelchair Vans',
    city: 'Cincinnati',
    state: 'OH',
    phone: '(513) 555-0177',
    website: 'https://ohiovalleywav.com',
    qapCertified: true,
    distanceMiles: 47,
  },
]

export function Default() {
  return <NmedaDealersNearby dealers={dealers} hasCoordinates />
}

export function ExactlyThreeDealers() {
  return <NmedaDealersNearby dealers={dealers.slice(0, 3)} hasCoordinates />
}

export function NoneNearby() {
  return <NmedaDealersNearby dealers={[]} hasCoordinates />
}
