import { SimilarListings } from '@wivwav/web'

const listings = [
  {
    id: 'l1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2020,
    priceCents: 3990000,
    mileage: 41200,
    city: 'Columbus',
    state: 'OH',
    condition: 'used',
    rampType: 'in_floor',
    conversionManufacturer: 'BraunAbility',
    listedAt: '2026-06-20',
  },
  {
    id: 'l2',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    priceCents: 4890000,
    mileage: 12800,
    city: 'Dublin',
    state: 'OH',
    condition: 'certified_pre_owned',
    rampType: 'fold_out',
    conversionManufacturer: 'VMI',
    listedAt: '2026-07-05',
  },
  {
    id: 'l3',
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    priceCents: 6295000,
    mileage: 0,
    city: 'Westerville',
    state: 'OH',
    condition: 'new',
    rampType: 'in_floor',
    conversionManufacturer: 'Rollx Vans',
    listedAt: '2026-07-11',
  },
]

export function Default() {
  return <SimilarListings listings={listings} make="Toyota" model="Sienna" />
}

export function SingleResult() {
  return <SimilarListings listings={[listings[0]!]} make="Toyota" model="Sienna" />
}
