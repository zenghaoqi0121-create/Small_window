using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Program {
    public static bool Diagnostic;
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    static readonly object OutputLock = new object();
    public static void Emit(object value) { lock (OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }
    public static Dictionary<string, object> Parse(string value) { return Json.Deserialize<Dictionary<string, object>>(value); }
    public static string Text(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) && item != null ? item.ToString() : ""; }
    public static bool Flag(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) && item is bool && (bool)item; }
    [STAThread] static int Main(string[] args) {
        Diagnostic = Array.IndexOf(args,"--diagnostic") >= 0;
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length > 0 && args[0] == "--self-test") return NativeTests.Run();
        if (args.Length > 1 && args[0] == "--render") {
            using (Popup p = new Popup(true)) {
                p.Show(); Application.DoEvents();
                using (Bitmap bitmap = new Bitmap(p.Width, p.Height)) { p.DrawToBitmap(bitmap, new Rectangle(Point.Empty, p.Size)); bitmap.Save(args[1], ImageFormat.Png); }
                p.Finish();
            }
            return 0;
        }
        Application.Run(new Popup(args.Length > 0 && args[0] == "--preview")); return 0;
    }
}

sealed class TranscriptBuffer {
    long committed = -1; long revision = -1; int next; int total; readonly StringBuilder buffer = new StringBuilder();
    public void Reset() { committed = revision = -1; next = total = 0; buffer.Clear(); }
    public string Push(long rev, int index, int count, string text) {
        if (rev <= committed || rev < revision || count < 1 || count > 2048 || index < 0 || index >= count || text.Length > 8000) return null;
        if (index == 0) { revision = rev; next = 0; total = count; buffer.Clear(); }
        if (revision != rev || next != index || total != count) return null;
        if (buffer.Length + text.Length > 16384000) throw new InvalidOperationException("回复过长，请在主窗口查看。");
        buffer.Append(text); next++;
        if (next != total) return null;
        committed = rev; string result = buffer.ToString(); buffer.Clear(); return result;
    }
}

static class NativeTests {
    public static int Run() {
        if (Selection.Normalize(new Point(80,90), new Point(10,20)) != new Rectangle(10,20,70,70)) return 1;
        if (Selection.Normalize(Point.Empty, Point.Empty).Width != 0) return 2;
        using (Bitmap b = new Bitmap(30,20)) using (Graphics g = Graphics.FromImage(b)) {
            g.Clear(Color.CornflowerBlue);
            using (MemoryStream m = new MemoryStream()) { b.Save(m, ImageFormat.Png); if (m.ToArray()[0] != 137) return 3; }
        }
        TranscriptBuffer t = new TranscriptBuffer();
        if (t.Push(1,0,2,"长回复\n") != null || t.Push(1,1,2,"第二段") != "长回复\n第二段") return 4;
        if (t.Push(1,0,1,"重复") != null || t.Push(0,0,1,"过期") != null) return 5;
        if (t.Push(3,1,2,"丢失开头") != null || t.Push(4,0,1,"新回复") != "新回复") return 6;
        t.Reset(); if (t.Push(1,0,1,"新会话") != "新会话") return 7;
        Program.Emit(new { type = "test", ok = true, cases = 7 }); return 0;
    }
}

sealed class Popup : Form {
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int message, IntPtr w, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool GetScrollInfo(IntPtr h, int bar, ref ScrollInfo info);
    [StructLayout(LayoutKind.Sequential)] struct ScrollInfo { public uint size, mask; public int min,max; public uint page; public int pos,track; }
    readonly TextBox question = new TextBox(); readonly Label status = new Label();
    readonly Label target = new Label(); readonly Label shortcut = new Label();
    readonly PictureBox preview = new PictureBox(); readonly Button submit = new Button();
    readonly Button capture = new Button(); readonly Button clear = new Button(); readonly Button stop = new Button();
    readonly RichTextBox history = new RichTextBox(); readonly TranscriptBuffer transcript = new TranscriptBuffer();
    readonly bool previewMode;
    string bindingId = ""; string pendingId = ""; string pendingAction = ""; string liveStatus = "complete"; string operationError = "";
    bool busy; bool selecting; bool allowQuit; bool connected = true; bool running; Bitmap image;
    long inputVersion; long submittedVersion;
    string hotkey = "Alt+Space";
    public Popup(bool previewOnly) {
        previewMode = previewOnly;
        Text = "拾窗 · 对话浮窗"; ClientSize = new Size(580,740); MinimumSize = new Size(560,650); StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = previewOnly || Program.Diagnostic; TopMost = true;
        BackColor = Color.FromArgb(248,250,252); Font = new Font("Microsoft YaHei UI",10); KeyPreview = true;
        Label title = new Label { Text = "拾窗", Font = new Font(Font.FontFamily,19,FontStyle.Bold), ForeColor = Color.FromArgb(30,41,59), Bounds = new Rectangle(24,12,150,40) };
        shortcut.Text = hotkey; shortcut.ForeColor = Color.FromArgb(71,85,105); shortcut.TextAlign = ContentAlignment.MiddleRight;
        shortcut.Bounds = new Rectangle(270,18,286,28); shortcut.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        target.Text = "沿用 Harness 原会话与模型"; target.ForeColor = Color.FromArgb(71,85,105);
        target.Bounds = new Rectangle(24,55,532,24); target.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        history.Bounds = new Rectangle(24,87,532,390); history.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        history.ReadOnly = true; history.DetectUrls = false; history.BackColor = Color.White; history.BorderStyle = BorderStyle.FixedSingle;
        history.Font = new Font("Microsoft YaHei UI",10); history.AccessibleName = "原会话最近二十条消息与实时回答"; history.Text = "正在同步原会话最近消息…";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("复制选中文字",null,delegate { history.Copy(); });
        menu.Items.Add("全选",null,delegate { history.SelectAll(); });
        history.ContextMenuStrip = menu;
        preview.Bounds = new Rectangle(24,493,124,86); preview.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
        preview.BackColor = Color.FromArgb(226,232,240); preview.SizeMode = PictureBoxSizeMode.Zoom;
        preview.Paint += delegate(object sender, PaintEventArgs e) { if (image == null) TextRenderer.DrawText(e.Graphics,"可选截图",Font,preview.ClientRectangle,Color.FromArgb(71,85,105),TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter); };
        question.Multiline = true; question.AcceptsReturn = true; question.MaxLength = 12000; question.ScrollBars = ScrollBars.Vertical;
        question.AccessibleName = "消息或截图问题，可不填写"; question.Bounds = new Rectangle(160,493,396,86);
        question.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right; question.TextChanged += delegate { Dirty(); };
        capture.Text = "区域截图"; capture.AccessibleName = "选择屏幕区域截图"; capture.Bounds = new Rectangle(24,597,116,36); capture.Anchor = AnchorStyles.Bottom | AnchorStyles.Left; capture.Click += delegate { CaptureRegion(); };
        clear.Text = "清空"; clear.Bounds = new Rectangle(152,597,64,36); clear.Anchor = AnchorStyles.Bottom | AnchorStyles.Left; clear.Click += delegate { ClearInput(); };
        stop.Text = "停止生成"; stop.Bounds = new Rectangle(320,597,112,36); stop.Anchor = AnchorStyles.Bottom | AnchorStyles.Right; stop.Enabled = false; stop.Click += delegate { Stop(); };
        submit.Text = "发送"; submit.Bounds = new Rectangle(444,597,112,36); submit.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        submit.BackColor = Color.FromArgb(37,99,235); submit.ForeColor = Color.White; submit.FlatStyle = FlatStyle.Flat; submit.FlatAppearance.BorderSize = 0; submit.Click += delegate { Submit(); };
        status.Text = "问题选填 · Ctrl+Enter 发送 · Esc 隐藏"; status.ForeColor = Color.FromArgb(71,85,105);
        status.Bounds = new Rectangle(24,650,532,62); status.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        Controls.AddRange(new Control[] { title,shortcut,target,history,preview,question,capture,clear,stop,submit,status });
        KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) { Hide(); e.SuppressKeyPress = true; } else if (e.Control && e.KeyCode == Keys.Enter) { Submit(); e.SuppressKeyPress = true; } };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!allowQuit && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        Shown += delegate {
            if (previewMode) {
                bindingId = "preview"; target.Text = "演示 · Harness 原会话";
                history.Text = "你\n[图片]\n请分析这张截图。\n\n────────────────\n\n助手\n回答将在这里实时显示。\n你可以选中文字复制，也可以继续追问。";
                return;
            }
            if (!RegisterHotKey(Handle,1,0x4001,0x20)) {
                hotkey = "Ctrl+Alt+Space";
                if (!RegisterHotKey(Handle,1,0x4003,0x20)) hotkey = "快捷键被占用，请用会话按钮打开";
            }
            shortcut.Text = hotkey; Hide();
            new Thread(delegate() {
                try {
                    string line;
                    while ((line = Console.ReadLine()) != null) {
                        if (Program.Diagnostic) Program.Emit(new { type = "diagnostic", stage = "read" });
                        if (line.Length > 65536) continue;
                        Dictionary<string,object> message;
                        try { message = Program.Parse(line); } catch { continue; }
                        BeginInvoke(new Action(delegate { Receive(message); }));
                    }
                } catch (InvalidOperationException) {} catch (IOException) {}
                try { BeginInvoke(new Action(Finish)); } catch (InvalidOperationException) {}
            }) { IsBackground = true }.Start();
            Program.Emit(new { type = "ready", hotkey = hotkey });
        };
        FormClosed += delegate { UnregisterHotKey(Handle,1); if (image != null) image.Dispose(); menu.Dispose(); };
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x0312 && !selecting) { if (Visible) Hide(); else Program.Emit(new { type = "open" }); }
        base.WndProc(ref m);
    }
    void Receive(Dictionary<string,object> m) {
        string type = Program.Text(m,"type");
        if (Program.Diagnostic) Program.Emit(new { type = "diagnostic", stage = "receive", kind = type });
        if (type == "quit") { Finish(); return; }
        if (type == "show") {
            string next = Program.Text(m,"bindingId");
            if (next != bindingId) { ClearInput(); transcript.Reset(); history.Text = "正在同步原会话最近消息…"; running = false; liveStatus = "complete"; pendingId = ""; SetBusy(false); }
            bindingId = next; target.Text = "目标会话：" + Program.Text(m,"title"); Show(); Activate(); question.Focus(); return;
        }
        if (type == "connection") {
            connected = Program.Flag(m,"connected");
            if (!busy) status.Text = connected ? "连接已恢复，正在同步…" : "连接中断，恢复后继续同步；不会自动重发。";
            UpdateButtons(); return;
        }
        if (type == "error") {
            if (Program.Flag(m,"retry") && Program.Text(m,"requestId") == pendingId) { pendingId = ""; SetBusy(false); }
            operationError = Program.Text(m,"text"); status.Text = operationError; Show(); Activate(); return;
        }
        if (Program.Text(m,"bindingId") != bindingId) return;
        if (type == "sending" && Program.Text(m,"requestId") == pendingId) status.Text = pendingAction == "stop" ? "正在停止生成…" : "发送中…";
        else if (type == "receipt" && Program.Text(m,"requestId") == pendingId) {
            string result = Program.Text(m,"status");
            if (result != "unknown") pendingId = "";
            SetBusy(false);
            if (result == "accepted") {
                if (submittedVersion == inputVersion) { ClearInput(); status.Text = "已接收，等待原会话回答…"; }
                else { operationError = ""; status.Text = "先前消息已接收，当前输入已保留。"; }
            }
            else if (result == "stopped") status.Text = "已请求停止生成。";
            else { operationError = Program.Text(m,"error"); status.Text = operationError; }
        } else if (type == "transcript") {
            try {
                string text = transcript.Push(Convert.ToInt64(m["revision"]),Convert.ToInt32(m["index"]),Convert.ToInt32(m["total"]),Program.Text(m,"text"));
                if (text == null) return;
                ReplaceHistory(text.Length == 0 ? "这个会话还没有可显示的消息。" : text);
                target.Text = "目标会话：" + Program.Text(m,"title");
                liveStatus = Program.Text(m,"status"); running = Program.Flag(m,"running");
                if (!busy) status.Text = operationError.Length > 0 ? operationError : Program.Text(m,"error").Length > 0 ? Program.Text(m,"error") : StatusLabel(liveStatus);
                UpdateButtons();
            } catch (Exception e) { status.Text = e.Message; }
        }
    }
    static string StatusLabel(string value) {
        switch (value) {
            case "generating": return "生成中…";
            case "queued": return "排队中，当前回答结束后继续处理。";
            case "stopped": return "已停止，可继续追问。";
            case "failed": return "回答失败，请检查原会话。";
            case "unavailable": return "目标会话不可用。";
            case "disconnected": return "连接中断，恢复后继续同步。";
            default: return "已完成 · Ctrl+Enter 发送 · Esc 隐藏";
        }
    }
    void ReplaceHistory(string text) {
        if (history.Text == text) return;
        ScrollInfo info = new ScrollInfo { size = (uint)Marshal.SizeOf(typeof(ScrollInfo)), mask = 7 };
        GetScrollInfo(history.Handle,1,ref info);
        bool bottom = info.pos >= info.max - (int)info.page - 3;
        Point scroll = Point.Empty; SendMessage(history.Handle,0x04DD,IntPtr.Zero,ref scroll);
        int start = history.SelectionStart, length = history.SelectionLength;
        SendMessage(history.Handle,0x000B,IntPtr.Zero,IntPtr.Zero);
        history.Text = text;
        if (bottom && length == 0) { history.Select(history.TextLength,0); history.ScrollToCaret(); }
        else {
            start = Math.Min(start,history.TextLength); history.Select(start,Math.Min(length,history.TextLength-start));
            SendMessage(history.Handle,0x04DE,IntPtr.Zero,ref scroll);
        }
        SendMessage(history.Handle,0x000B,new IntPtr(1),IntPtr.Zero); history.Invalidate();
    }
    void UpdateButtons() {
        bool available = connected && liveStatus != "unavailable" && liveStatus != "disconnected";
        submit.Enabled = !busy && available; stop.Enabled = !busy && running && available;
        capture.Enabled = clear.Enabled = question.Enabled = !busy;
    }
    void SetBusy(bool value) { busy = value; UpdateButtons(); }
    void Dirty() { inputVersion++; if (!previewMode && bindingId.Length > 0) Program.Emit(new { type = "dirty", bindingId = bindingId, dirty = image != null || question.Text.Length > 0 }); }
    void ClearInput() { operationError = ""; question.Clear(); preview.Image = null; if (image != null) { image.Dispose(); image = null; } preview.Invalidate(); Dirty(); }
    public void Finish() { allowQuit = true; Close(); }
    void Stop() {
        if (busy || !stop.Enabled || bindingId.Length == 0) return;
        operationError = ""; pendingId = Guid.NewGuid().ToString("N"); pendingAction = "stop"; SetBusy(true); status.Text = "正在停止生成…";
        Program.Emit(new { type = "stop", bindingId = bindingId, requestId = pendingId });
    }
    void Submit() {
        if (busy || selecting || !submit.Enabled) return;
        if (bindingId.Length == 0) { status.Text = "请先从 Harness 选择目标会话。"; return; }
        if (String.IsNullOrWhiteSpace(question.Text) && image == null) { status.Text = "请先截图或输入消息，问题可以不填。"; return; }
        string data = null;
        if (image != null) using (MemoryStream stream = new MemoryStream()) {
            image.Save(stream,ImageFormat.Png);
            if (stream.Length > 8 * 1024 * 1024) { status.Text = "截图超过 8MB，请缩小选区。"; return; }
            data = Convert.ToBase64String(stream.ToArray());
        }
        if (previewMode) { status.Text = "演示模式：不会发送到模型。"; return; }
        operationError = ""; submittedVersion = inputVersion; pendingId = Guid.NewGuid().ToString("N"); pendingAction = "send"; SetBusy(true); status.Text = "发送中…";
        Program.Emit(new { type = "submit", bindingId = bindingId, requestId = pendingId, question = question.Text, image = data });
    }
    void CaptureRegion() {
        if (busy || selecting) return;
        selecting = true; Hide();
        System.Windows.Forms.Timer delay = new System.Windows.Forms.Timer { Interval = 180 };
        delay.Tick += delegate {
            delay.Stop(); delay.Dispose();
            try {
                Rectangle area = SystemInformation.VirtualScreen;
                if ((long)area.Width * area.Height > 100000000) throw new InvalidOperationException("屏幕尺寸过大。");
                using (Bitmap desktop = new Bitmap(area.Width,area.Height)) {
                    using (Graphics g = Graphics.FromImage(desktop)) g.CopyFromScreen(area.Location,Point.Empty,area.Size);
                    using (Selection select = new Selection(desktop,area)) {
                        if (select.ShowDialog() == DialogResult.OK) {
                            Bitmap next = desktop.Clone(select.Selected,PixelFormat.Format32bppArgb);
                            preview.Image = next; if (image != null) image.Dispose(); image = next; Dirty();
                            status.Text = "已截图 " + next.Width + " × " + next.Height + " · 问题选填，点击发送即可。";
                        } else status.Text = "已取消截图，原来的内容已保留。";
                    }
                }
            } catch (Exception) { status.Text = "截图失败，请重试；远程桌面或受保护内容可能无法截图。"; }
            finally { selecting = false; Show(); Activate(); question.Focus(); }
        }; delay.Start();
    }
}

sealed class Selection : Form {
    readonly Bitmap desktop; Point start; Point current; bool dragging;
    public Rectangle Selected { get; private set; }
    public static Rectangle Normalize(Point a, Point b) { return Rectangle.FromLTRB(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y)); }
    public Selection(Bitmap source, Rectangle bounds) {
        desktop = source; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual;
        Bounds = bounds; TopMost = true; ShowInTaskbar = false; DoubleBuffered = true; Cursor = Cursors.Cross; KeyPreview = true;
        KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); } };
        MouseDown += delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Right) { DialogResult = DialogResult.Cancel; Close(); return; } start = current = e.Location; dragging = true; Capture = true; };
        MouseMove += delegate(object sender, MouseEventArgs e) { if (dragging) { current = e.Location; Invalidate(); } };
        MouseUp += delegate(object sender, MouseEventArgs e) {
            if (!dragging || e.Button != MouseButtons.Left) return;
            dragging = false; Capture = false;
            Selected = Rectangle.Intersect(Normalize(start, e.Location), new Rectangle(Point.Empty, desktop.Size));
            if (Selected.Width < 3 || Selected.Height < 3) return;
            DialogResult = DialogResult.OK; Close();
        };
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.DrawImageUnscaled(desktop, Point.Empty);
        using (Brush shade = new SolidBrush(Color.FromArgb(105, 15, 23, 42))) e.Graphics.FillRectangle(shade, ClientRectangle);
        Rectangle selected = Rectangle.Intersect(Normalize(start, current), ClientRectangle);
        if (selected.Width > 0 && selected.Height > 0) {
            e.Graphics.DrawImage(desktop, selected, selected, GraphicsUnit.Pixel);
            using (Pen p = new Pen(Color.FromArgb(59, 130, 246), 2)) e.Graphics.DrawRectangle(p, selected);
        }
        TextRenderer.DrawText(e.Graphics, "拖动选择区域 · Esc / 右键取消", new Font("Microsoft YaHei UI", 12), new Point(24, 24), Color.White, Color.FromArgb(30, 41, 59));
    }
}
