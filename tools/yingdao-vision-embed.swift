import AppKit
import Foundation
import Vision

struct Job: Decodable { let goods_id: String; let path: String }
struct Result: Encodable {
  let goods_id: String
  let dimension: Int?
  let embedding_base64: String?
  let error: String?
}

let decoder = JSONDecoder()
let encoder = JSONEncoder()
while let line = readLine() {
  do {
    let job = try decoder.decode(Job.self, from: Data(line.utf8))
    guard let image = NSImage(contentsOfFile: job.path) else { throw NSError(domain:"VISION_IMAGE_DECODE",code:1) }
    var rect = NSRect(origin:.zero,size:image.size)
    guard let cgImage = image.cgImage(forProposedRect:&rect,context:nil,hints:nil) else { throw NSError(domain:"VISION_CGIMAGE",code:2) }
    let request = VNGenerateImageFeaturePrintRequest()
    request.revision = VNGenerateImageFeaturePrintRequestRevision2
    try VNImageRequestHandler(cgImage:cgImage).perform([request])
    guard let observation = request.results?.first as? VNFeaturePrintObservation else { throw NSError(domain:"VISION_RESULT",code:3) }
    let result = Result(goods_id:job.goods_id,dimension:observation.elementCount,
      embedding_base64:observation.data.base64EncodedString(),error:nil)
    print(String(data:try encoder.encode(result),encoding:.utf8)!)
  } catch {
    let goods = (try? decoder.decode(Job.self,from:Data(line.utf8)).goods_id) ?? ""
    let result = Result(goods_id:goods,dimension:nil,embedding_base64:nil,error:String(describing:error))
    print(String(data:try encoder.encode(result),encoding:.utf8)!)
  }
}
