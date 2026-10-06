// Read-only S0 probe. Apple Vision is a local macOS evaluation backend,
// not a commitment to a Linux production OCR implementation.
import Foundation
import Vision
import ImageIO

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: swift tools/s0/ocr-macos.swift IMAGE_PATH\n", stderr)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false
let start = Date()
do {
    try VNImageRequestHandler(url: url).perform([request])
    let observations = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let b = observation.boundingBox
        return ["text": candidate.string, "confidence": candidate.confidence,
                "bounding_box": ["x": b.minX, "y": b.minY, "width": b.width, "height": b.height]]
    }
    let result: [String: Any] = ["backend": "apple_vision_local_probe", "input_kind": "historical_public_profile",
                               "elapsed_ms": Int(Date().timeIntervalSince(start) * 1000), "observations": observations]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
} catch {
    fputs("OCR probe failed: \(error)\n", stderr)
    exit(1)
}
