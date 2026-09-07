// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CareerRepository } from "./repository";
import { prepareResumeDownload } from "./resume-download";
import mammoth from "mammoth";
describe("independent listing copies", () => {
 it("exports the captured profile after edits, with distinct versions and immutable imports", async () => {
  const repo = CareerRepository.inMemory();
  try {
   const original = repo.createResumeImport({originalFilename:"synthetic.txt",mediaType:"text/plain",extractedText:"Example Original"});
   const profile = repo.saveProfile({fullName:"Example Original",email:"original@example.test",skills:[],experiences:[],projects:[],education:[]});
   const a = repo.createJob({title:"Role A",company:"Example A",description:"Build reliable firmware systems."});
   const b = repo.createJob({title:"Role B",company:"Example B",description:"Build reliable Python systems."});
   const av = repo.createResumeVersion(a.id,{jobId:a.id,mode:"deterministic",createdAt:"2026-01-01",suggestions:[]});
   repo.saveProfile({...profile,fullName:"Example Changed"});
   const bv = repo.createResumeVersion(b.id,{jobId:b.id,mode:"deterministic",createdAt:"2026-01-01",suggestions:[]});
   expect(av.id).not.toBe(bv.id);
   const request = new Request("http://localhost",{headers:{"remote-user":"synthetic","remote-groups":"admins"}});
   const auth = {mode:"authelia" as const,allowedGroups:["admins"],allowedUsers:[]};
   const response = await prepareResumeDownload(request,av.id,"docx",repo,auth);
   const text = (await mammoth.extractRawText({buffer:Buffer.from(await response.arrayBuffer())})).value;
   expect(text).toContain("Example Original"); expect(text).not.toContain("Example Changed");
   expect(repo.getResumeImport(original.id)).toEqual(original);
   expect(repo.getResumeVersion(av.id)).toEqual(av);
   expect(repo.getProfile()?.fullName).toBe("Example Changed");
  } finally {repo.close();}
 });
});
