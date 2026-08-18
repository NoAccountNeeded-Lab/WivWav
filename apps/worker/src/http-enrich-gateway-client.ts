import type {
  ComplaintUpsertRequest,
  DealerCandidate,
  DealerEnrichSubmitRequest,
  InvestigationUpsertRequest,
  ManufacturerCommunicationUpsertRequest,
  ModelResearchSubmitRequest,
  ModelResearchSubmitResponse,
  RecallUpsertRequest,
  SafetyRatingUpsertRequest,
  FuelEconomyMsrpUpsertRequest,
  VehicleModelSummary,
  VinEnrichCandidate,
  VinEnrichResolveRequest,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpClient } from './http-client.js'

/**
 * Typed wrapper over every `/internal/scraper/http-enrich/*` route (#963) —
 * the DB read/write surface the 9 outbound-HTTP job handlers call instead of
 * touching `@wivwav/db` directly. Deliberately a separate class from
 * `ScraperGatewayClient`: different job family, same auth/base-URL as every
 * other coordinator call this worker makes.
 */
export class HttpEnrichGatewayClient {
  constructor(private readonly http: HttpClient) {}

  listVehicleModels(vehicleModelId?: string): Promise<{ vehicleModels: VehicleModelSummary[] }> {
    return this.http.post('/internal/scraper/http-enrich/vehicle-models/list', { vehicleModelId })
  }

  upsertRecall(body: RecallUpsertRequest): Promise<void> {
    return this.http.post('/internal/scraper/http-enrich/recalls/upsert', body)
  }

  upsertComplaint(body: ComplaintUpsertRequest): Promise<void> {
    return this.http.post('/internal/scraper/http-enrich/complaints/upsert', body)
  }

  upsertSafetyRating(body: SafetyRatingUpsertRequest): Promise<void> {
    return this.http.post('/internal/scraper/http-enrich/safety-ratings/upsert', body)
  }

  upsertInvestigation(body: InvestigationUpsertRequest): Promise<void> {
    return this.http.post('/internal/scraper/http-enrich/investigations/upsert', body)
  }

  upsertManufacturerCommunication(body: ManufacturerCommunicationUpsertRequest): Promise<void> {
    return this.http.post('/internal/scraper/http-enrich/manufacturer-communications/upsert', body)
  }

  claimVinEnrichListings(limit: number): Promise<{ listings: VinEnrichCandidate[] }> {
    return this.http.post('/internal/scraper/http-enrich/vin-enrich/claim', { limit })
  }

  resolveVinEnrichListing(body: VinEnrichResolveRequest): Promise<{ vehicleModelId: string | null }> {
    return this.http.post('/internal/scraper/http-enrich/vin-enrich/resolve', body)
  }

  listModelResearchPending(researchVersion: number): Promise<{ vehicleModels: VehicleModelSummary[] }> {
    return this.http.post('/internal/scraper/http-enrich/model-research/pending', { researchVersion })
  }

  submitModelResearch(body: ModelResearchSubmitRequest): Promise<ModelResearchSubmitResponse> {
    return this.http.post('/internal/scraper/http-enrich/model-research/submit', body)
  }

  upsertFuelEconomyMsrp(body: FuelEconomyMsrpUpsertRequest): Promise<void> {
    return this.http.post('/internal/scraper/http-enrich/fueleconomy-msrp/upsert', body)
  }

  listDealerEnrichPending(limit: number, staleThreshold: Date): Promise<{ dealers: DealerCandidate[] }> {
    return this.http.post('/internal/scraper/http-enrich/dealer-enrich/pending', { limit, staleThreshold })
  }

  submitDealerEnrich(body: DealerEnrichSubmitRequest): Promise<{ dealerId: string }> {
    return this.http.post('/internal/scraper/http-enrich/dealer-enrich/submit', body)
  }
}
