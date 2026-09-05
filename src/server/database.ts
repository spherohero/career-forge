import { join } from "node:path";
import { CareerRepository } from "./repository";

declare global {
  var careerForgeRepository: CareerRepository | undefined;
}

export function getRepository(): CareerRepository {
  if (!globalThis.careerForgeRepository) {
    const databasePath =
      process.env.DATABASE_PATH ?? join(process.cwd(), "data", "career-forge.db");
    globalThis.careerForgeRepository = CareerRepository.open(databasePath);
  }
  return globalThis.careerForgeRepository;
}
