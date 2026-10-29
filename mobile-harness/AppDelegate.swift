import UIKit
import WebKit
import Foundation

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = HarnessViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

/// Drives https://bencaoyou.tryliang.me inside a real WKWebView on the physical iPhone.
/// Reads Documents/testplan.json, runs the steps through real WebKit, writes
/// Documents/report.json and screenshots to Documents/shots, then exits.
final class HarnessViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var steps: [[String: Any]] = []
    private var results: [[String: Any]] = []
    private var logs: [[String: Any]] = []
    private var startURL = "https://bencaoyou.tryliang.me/"
    private let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        loadPlan()

        let userContent = WKUserContentController()
        let hook = """
        (function(){
          function send(level, args){ try { window.webkit.messageHandlers.dbg.postMessage({level: level, text: Array.prototype.map.call(args, function(a){ try { return typeof a === 'string' ? a : JSON.stringify(a) } catch(e){ return String(a) } }).join(' ')}) } catch(e){} }
          ['log','info','warn','error'].forEach(function(l){ var o = console[l]; console[l] = function(){ send(l, arguments); return o.apply(console, arguments) } });
          window.addEventListener('error', function(e){ send('pageerror', [e.message + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')]) });
          window.addEventListener('unhandledrejection', function(e){ send('unhandledrejection', [String(e.reason)]) });
        })();
        """
        userContent.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        userContent.add(self, name: "dbg")
        userContent.add(self, name: "image")

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = userContent
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        view.addSubview(webView)

        writeReport(final: nil)
        if let url = URL(string: startURL) { webView.load(URLRequest(url: url)) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.runStep(0) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "image" {
            guard let body = message.body as? [String: Any],
                  let name = body["name"] as? String,
                  let dataUrl = body["dataUrl"] as? String,
                  let comma = dataUrl.firstIndex(of: ","),
                  let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])) else { return }
            let dir = docs.appendingPathComponent("shots", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? data.write(to: dir.appendingPathComponent("\(name).png"))
            return
        }
        guard let body = message.body as? [String: Any] else { return }
        logs.append([
            "level": body["level"] ?? "?",
            "text": body["text"] ?? "",
            "at": Date().timeIntervalSince1970,
        ])
        if logs.count > 600 { logs.removeFirst(logs.count - 600) }
    }

    private func loadPlan() {
        let url = docs.appendingPathComponent("testplan.json")
        guard let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        if let u = obj["url"] as? String { startURL = u }
        if let s = obj["steps"] as? [[String: Any]] { steps = s }
    }

    private func runStep(_ index: Int) {
        if index >= steps.count { finishRun(); return }
        let step = steps[index]
        let op = (step["op"] as? String) ?? ""
        let tag = (step["name"] as? String) ?? op
        doStep(step) { ok, err, value in
            var rec: [String: Any] = ["index": index, "op": op, "name": tag, "ok": ok]
            if let err = err { rec["error"] = err }
            if let value = value { rec["value"] = value }
            self.results.append(rec)
            self.writeReport(final: nil)
            self.runStep(index + 1)
        }
    }

    private func doStep(_ step: [String: Any], done: @escaping (Bool, String?, Any?) -> Void) {
        let op = (step["op"] as? String) ?? ""
        if op == "wait" {
            let ms = (step["ms"] as? Int) ?? Int((step["ms"] as? Double) ?? 1000)
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(ms)) { done(true, nil, nil) }
            return
        }
        if op == "shot" {
            let name = (step["name"] as? String) ?? "shot-\(results.count)"
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(350)) {
                self.snapshot(name: name, done: done)
            }
            return
        }
        runJS(step: step, done: done)
    }

    private func jsLiteral(_ value: Any?) -> String {
        guard let value = value else { return "null" }
        if let s = value as? String {
            if let data = try? JSONSerialization.data(withJSONObject: [s]),
               let arr = String(data: data, encoding: .utf8) {
                return String(arr.dropFirst().dropLast())
            }
            return "\"\""
        }
        if let n = value as? NSNumber { return n.stringValue }
        return "null"
    }

    private func runJS(step: [String: Any], done: @escaping (Bool, String?, Any?) -> Void) {
        let op = (step["op"] as? String) ?? ""
        let timeout = (step["timeout"] as? Int) ?? 15000
        var body = ""
        switch op {
        case "eval":
            body = (step["js"] as? String) ?? "return null;"
        case "waitFor", "waitCanvas":
            let sel = op == "waitCanvas" ? ".phaser-host canvas" : jsLiteral(step["selector"])
            body = """
            const sel = \(sel);
            const deadline = Date.now() + \(timeout);
            while (Date.now() < deadline) {
              const el = document.querySelector(sel);
              if (el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden') return {ok:true, sel};
              await new Promise(function(r){ setTimeout(r, 250) });
            }
            throw new Error('timeout waiting for ' + sel);
            """
        case "waitText":
            let text = jsLiteral(step["text"])
            body = """
            const text = \(text);
            const deadline = Date.now() + \(timeout);
            while (Date.now() < deadline) {
              const t = (document.body && document.body.innerText) || '';
              if (t.indexOf(text) >= 0) return {ok:true, text};
              await new Promise(function(r){ setTimeout(r, 300) });
            }
            throw new Error('timeout waiting for text: ' + text);
            """
        case "waitEval":
            let expr = (step["js"] as? String) ?? "false"
            body = """
            const deadline = Date.now() + \(timeout);
            let last = null;
            while (Date.now() < deadline) {
              try { last = (\(expr)); if (last) return {ok:true, value:last}; } catch(e) { last = String(e) }
              await new Promise(function(r){ setTimeout(r, 300) });
            }
            throw new Error('timeout waiting for eval: ' + String(last));
            """
        case "waitEnabled":
            let sel = jsLiteral(step["selector"])
            body = """
            const sel = \(sel);
            const deadline = Date.now() + \(timeout);
            while (Date.now() < deadline) {
              const el = document.querySelector(sel);
              if (el && !el.disabled && el.getClientRects().length > 0) return {ok:true, sel};
              await new Promise(function(r){ setTimeout(r, 250) });
            }
            throw new Error('timeout waiting for enabled: ' + sel);
            """
        case "assertText":
            let text = jsLiteral(step["text"])
            body = """
            const text = \(text);
            const t = (document.body && document.body.innerText) || '';
            if (t.indexOf(text) < 0) throw new Error('missing text: ' + text);
            return {ok:true, text};
            """
        case "tapSel":
            let sel = jsLiteral(step["selector"])
            body = """
            const sel = \(sel);
            const el = document.querySelector(sel);
            if (!el) throw new Error('no element: ' + sel);
            el.scrollIntoView({block:'center', inline:'center'});
            await new Promise(function(r){ setTimeout(r, 120) });
            el.click();
            return {ok:true, sel, text:(el.textContent||'').trim().slice(0,40)};
            """
        case "tapText":
            let text = jsLiteral(step["text"])
            let within = step["within"].map { jsLiteral($0) } ?? "null"
            body = """
            const text = \(text);
            const within = \(within);
            const root = within ? document.querySelector(within) : document;
            const els = Array.prototype.slice.call(root.querySelectorAll('button,a,[role=button],label'));
            const el = els.find(function(e){ return e.getClientRects().length > 0 && (e.textContent||'').indexOf(text) >= 0 });
            if (!el) throw new Error('no clickable text: ' + text);
            el.scrollIntoView({block:'center', inline:'center'});
            await new Promise(function(r){ setTimeout(r, 120) });
            el.click();
            return {ok:true, text:(el.textContent||'').trim().slice(0,40), tag:el.tagName};
            """
        case "tapWorld", "dragWorld":
            let canvasSel = jsLiteral(step["canvas"] ?? ".phaser-host canvas")
            let wx1 = jsLiteral(step["x1"] ?? step["x"])
            let wy1 = jsLiteral(step["y1"] ?? step["y"])
            let wx2 = jsLiteral(step["x2"] ?? step["x"])
            let wy2 = jsLiteral(step["y2"] ?? step["y"])
            let stepsN = (step["steps"] as? Int) ?? 14
            body = """
            const canvas = document.querySelector(\(canvasSel));
            if (!canvas) throw new Error('no canvas');
            const r = canvas.getBoundingClientRect();
            function pt(wx, wy){ return {x: r.left + wx * r.width / 1080, y: r.top + wy * r.height / 1920} }
            function fire(type, p, buttons){
              canvas.dispatchEvent(new PointerEvent(type, {bubbles:true, cancelable:true, composed:true,
                clientX:p.x, clientY:p.y, pointerId:1, pointerType:'touch', isPrimary:true, button:0,
                buttons:buttons, width:1, height:1, pressure:buttons ? 0.5 : 0}));
            }
            const a = pt(\(wx1), \(wy1));
            const b = pt(\(wx2), \(wy2));
            fire('pointerdown', a, 1);
            await new Promise(function(r){ setTimeout(r, 80) });
            const n = \(stepsN);
            for (let i = 1; i <= n; i++) {
              fire('pointermove', {x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n}, 1);
              await new Promise(function(r){ setTimeout(r, 35) });
            }
            await new Promise(function(r){ setTimeout(r, 60) });
            fire('pointerup', b, 0);
            return {ok:true, from:a, to:b, rect:{x:r.x,y:r.y,w:r.width,h:r.height}};
            """
        case "scroll":
            let dy = jsLiteral(step["dy"] ?? 0)
            body = """
            const dy = \(dy);
            const all = [document.scrollingElement].concat(Array.prototype.slice.call(document.querySelectorAll('*')));
            let scroller = document.scrollingElement;
            for (const e of all) {
              if (!e || e === document.body || e === document.documentElement) continue;
              const cs = getComputedStyle(e);
              if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 30) { scroller = e; break }
            }
            scroller.scrollBy(0, dy);
            return {ok:true, top:scroller.scrollTop, height:scroller.scrollHeight, client:scroller.clientHeight};
            """
        case "shotCanvas":
            let name = jsLiteral(step["name"] ?? "canvas")
            body = """
            const game = window.__phaser;
            if (!game || !game.renderer || !game.renderer.snapshot) throw new Error('no phaser renderer');
            const name = \(name);
            game.renderer.snapshot(function(image){
              try {
                let url = '';
                if (image && image.src) url = image.src;
                else if (image && image.getAttribute) url = image.getAttribute('src') || '';
                if (!url) url = image && image.canvas ? image.canvas.toDataURL('image/png') : '';
                window.webkit.messageHandlers.image.postMessage({name:name, dataUrl:url});
              } catch(e) {
                window.webkit.messageHandlers.dbg.postMessage({level:'snap-error', text:String(e)});
              }
            });
            return {ok:true, name};
            """
        case "reload":
            body = "location.reload(); return {ok:true};"
        default:
            done(false, "unknown op \(op)", nil)
            return
        }

        webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page, completionHandler: { result in
            switch result {
            case .success(let value):
                done(true, nil, value as? String ?? (value as AnyObject).description)
            case .failure(let error):
                done(false, error.localizedDescription, nil)
            }
        })
    }

    private func snapshot(name: String, done: @escaping (Bool, String?, Any?) -> Void) {
        let cfg = WKSnapshotConfiguration()
        cfg.snapshotWidth = 1200
        webView.takeSnapshot(with: cfg) { image, error in
            guard let image = image, let data = image.pngData() else {
                done(false, error?.localizedDescription ?? "snapshot failed", nil)
                return
            }
            let dir = self.docs.appendingPathComponent("shots", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            do {
                try data.write(to: dir.appendingPathComponent("\(name).png"))
                done(true, nil, ["w": Int(image.size.width), "h": Int(image.size.height)])
            } catch {
                done(false, error.localizedDescription, nil)
            }
        }
    }

    private func writeReport(final: Any?) {
        var report: [String: Any] = [
            "startedURL": startURL,
            "steps": results,
            "logs": logs,
            "updatedAt": Date().timeIntervalSince1970,
        ]
        if let final = final { report["final"] = final }
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted]) {
            try? data.write(to: docs.appendingPathComponent("report.json"))
        }
        let marker = docs.appendingPathComponent("DONE")
        if final != nil { try? Data("done".utf8).write(to: marker) }
    }

    private func finishRun() {
        if finished { return }
        finished = true
        let js = "JSON.stringify({url: location.href, title: document.title, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, body: (document.body ? document.body.innerText.slice(0, 4000) : ''), bcy: (window.__bcy ? window.__bcy.snapshot : null)})"
        webView.evaluateJavaScript(js) { value, _ in
            var final: Any = value ?? ""
            if let s = value as? String, let data = s.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) {
                final = obj
            }
            self.writeReport(final: final)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { exit(0) }
        }
    }
}
