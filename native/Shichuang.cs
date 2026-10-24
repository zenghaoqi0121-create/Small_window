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
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    static readonly object OutputLock = new object();
    public static void Emit(object value) { lock (OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }
    public static Dictionary<string, object> Parse(string value) { return Json.Deserialize<Dictionary<string, object>>(value); }
    public static string Text(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) && item != null ? item.ToString() : ""; }
    [STAThread] static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length > 0 && args[0] == "--self-test") {
            Rectangle r = Selection.Normalize(new Point(80, 90), new Point(10, 20));
            if (r != new Rectangle(10, 20, 70, 70)) return 1;
            if (Selection.Normalize(new Point(0, 0), new Point(0, 0)).Width != 0) return 2;
            using (Bitmap b = new Bitmap(30, 20)) using (Graphics g = Graphics.FromImage(b)) {
                g.Clear(Color.CornflowerBlue);
                using (MemoryStream m = new MemoryStream()) { b.Save(m, ImageFormat.Png); if (m.ToArray()[0] != 137) return 3; }
            }
            Emit(new { type = "test", ok = true }); return 0;
        }
        bool preview = args.Length > 0 && args[0] == "--preview";
        if (args.Length > 1 && args[0] == "--render") {
            using (Popup p = new Popup(true)) {
                p.CreateControl();
                using (Bitmap bitmap = new Bitmap(p.Width, p.Height)) { p.DrawToBitmap(bitmap, new Rectangle(Point.Empty, p.Size)); bitmap.Save(args[1], ImageFormat.Png); }
            }
            return 0;
        }
        Application.Run(new Popup(preview)); return 0;
    }
}

sealed class Popup : Form {
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    readonly TextBox question = new TextBox(); readonly Label status = new Label();
    readonly Label target = new Label(); readonly Label shortcut = new Label();
    readonly PictureBox preview = new PictureBox(); readonly Button submit = new Button();
    readonly Button capture = new Button(); readonly Button clear = new Button();
    readonly bool previewMode; string id = ""; bool busy; bool selecting; bool allowQuit; Bitmap image;
    string hotkey = "Alt+Space";
    public Popup(bool previewOnly) {
        previewMode = previewOnly;
        Text = "拾窗 · 截图提问"; Size = new Size(548, 492); StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false; MinimizeBox = false;
        ShowInTaskbar = false; TopMost = true; BackColor = Color.FromArgb(248, 250, 252);
        Font = new Font("Microsoft YaHei UI", 10); KeyPreview = true;
        Label title = new Label { Text = "拾窗", Font = new Font(Font.FontFamily, 19, FontStyle.Bold), ForeColor = Color.FromArgb(30, 41, 59), Bounds = new Rectangle(24, 17, 150, 40) };
        shortcut.Text = hotkey; shortcut.ForeColor = Color.FromArgb(71, 85, 105); shortcut.TextAlign = ContentAlignment.MiddleRight; shortcut.Bounds = new Rectangle(295, 24, 205, 28);
        target.Text = "沿用 Harness 当前会话与模型"; target.ForeColor = Color.FromArgb(71, 85, 105); target.Bounds = new Rectangle(26, 62, 480, 24);
        preview.Bounds = new Rectangle(26, 96, 480, 142); preview.BackColor = Color.FromArgb(226, 232, 240); preview.SizeMode = PictureBoxSizeMode.Zoom;
        preview.Paint += delegate(object sender, PaintEventArgs e) { if (image == null) TextRenderer.DrawText(e.Graphics, "截取需要提问的区域", Font, preview.ClientRectangle, Color.FromArgb(71, 85, 105), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter); };
        question.Multiline = true; question.AcceptsReturn = true; question.MaxLength = 12000; question.ScrollBars = ScrollBars.Vertical; question.BorderStyle = BorderStyle.FixedSingle;
        question.AccessibleName = "输入截图问题"; question.Bounds = new Rectangle(26, 252, 480, 83);
        capture.Text = "区域截图"; capture.AccessibleName = "选择屏幕区域截图"; capture.Bounds = new Rectangle(26, 350, 114, 38); capture.Click += delegate { CaptureRegion(); };
        clear.Text = "清空"; clear.Bounds = new Rectangle(151, 350, 66, 38); clear.Click += delegate { Reset(); Program.Emit(new { type = "cancel", id = id }); id = ""; Hide(); };
        submit.Text = "放入会话"; submit.Bounds = new Rectangle(369, 350, 137, 38); submit.BackColor = Color.FromArgb(37, 99, 235); submit.ForeColor = Color.White; submit.FlatStyle = FlatStyle.Flat; submit.FlatAppearance.BorderSize = 0; submit.Click += delegate { Submit(); };
        status.Text = "Ctrl+Enter 放入草稿 · Esc 隐藏小窗"; status.ForeColor = Color.FromArgb(71, 85, 105); status.Bounds = new Rectangle(26, 401, 480, 40);
        Controls.AddRange(new Control[] { title, shortcut, target, preview, question, capture, clear, submit, status });
        KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) { Hide(); e.SuppressKeyPress = true; } else if (e.Control && e.KeyCode == Keys.Enter) { Submit(); e.SuppressKeyPress = true; } };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!allowQuit && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        Shown += delegate {
            if (!RegisterHotKey(Handle, 1, 0x4001, 0x20)) {
                hotkey = "Ctrl+Alt+Space";
                if (!RegisterHotKey(Handle, 1, 0x4003, 0x20)) hotkey = "快捷键被占用，请用会话按钮打开";
            }
            shortcut.Text = hotkey;
            if (previewMode) { id = "preview"; target.Text = "演示 · Harness 当前会话"; question.Text = "帮我解释这张截图中的内容"; return; }
            Hide();
            new Thread(delegate() {
                try {
                    string line;
                    while ((line = Console.ReadLine()) != null) {
                        if (line.Length > 65536) continue;
                        Dictionary<string, object> message;
                        try { message = Program.Parse(line); } catch { continue; }
                        BeginInvoke(new Action(delegate { Receive(message); }));
                    }
                } catch (InvalidOperationException) {} catch (IOException) {}
                try { BeginInvoke(new Action(Quit)); } catch (InvalidOperationException) {}
            }) { IsBackground = true }.Start();
            Program.Emit(new { type = "ready", hotkey = hotkey });
        };
        FormClosed += delegate { UnregisterHotKey(Handle, 1); if (image != null) image.Dispose(); };
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x0312 && !selecting) { if (Visible) Hide(); else Program.Emit(new { type = "open" }); }
        base.WndProc(ref m);
    }
    void Receive(Dictionary<string, object> m) {
        string type = Program.Text(m, "type");
        if (type == "quit") { Quit(); return; }
        if (type == "show") {
            string nextId = Program.Text(m, "id");
            if (id.Length > 0 && id != nextId) Reset();
            id = nextId; string session = Program.Text(m, "sessionId");
            target.Text = "目标会话：" + (session.Length > 46 ? session.Substring(0, 46) + "…" : session);
            Show(); Activate(); question.Focus();
        } else if (type == "queued" && Program.Text(m, "id") == id) {
            SetBusy(true); status.Text = Program.Text(m, "text");
        } else if (type == "delivered" && Program.Text(m, "id") == id) {
            Reset(); id = ""; status.Text = Program.Text(m, "text"); Hide();
        } else if (type == "error") {
            object retry;
            if (m.TryGetValue("retry", out retry) && retry is bool && (bool)retry) SetBusy(false);
            status.Text = Program.Text(m, "text"); Show(); Activate();
        }
    }
    void SetBusy(bool value) { busy = value; submit.Enabled = capture.Enabled = question.Enabled = !value; clear.Enabled = !value; }
    void Reset() { SetBusy(false); question.Clear(); preview.Image = null; if (image != null) { image.Dispose(); image = null; } preview.Invalidate(); status.Text = "Ctrl+Enter 放入草稿 · Esc 隐藏小窗"; }
    void Quit() { allowQuit = true; Close(); }
    void Submit() {
        if (busy || selecting) return;
        if (id.Length == 0) { status.Text = "请关闭小窗后重新通过会话按钮打开。"; return; }
        if (String.IsNullOrWhiteSpace(question.Text)) { status.Text = "先写下你想问的问题。"; question.Focus(); return; }
        string data = null;
        if (image != null) using (MemoryStream stream = new MemoryStream()) {
            image.Save(stream, ImageFormat.Png);
            if (stream.Length > 8 * 1024 * 1024) { status.Text = "截图超过 8MB，请缩小选区。"; return; }
            data = Convert.ToBase64String(stream.ToArray());
        }
        if (previewMode) { status.Text = "演示模式：不会发送到模型。"; return; }
        SetBusy(true); status.Text = "正在交给 Harness…";
        Program.Emit(new { type = "submit", id = id, question = question.Text, image = data });
    }
    void CaptureRegion() {
        if (busy || selecting) return;
        selecting = true; Hide();
        System.Windows.Forms.Timer delay = new System.Windows.Forms.Timer { Interval = 180 };
        delay.Tick += delegate {
            delay.Stop(); delay.Dispose();
            try {
                Rectangle area = SystemInformation.VirtualScreen;
                if ((long)area.Width * area.Height > 100000000) throw new InvalidOperationException("屏幕尺寸过大，请调整显示配置。");
                using (Bitmap desktop = new Bitmap(area.Width, area.Height)) {
                    using (Graphics g = Graphics.FromImage(desktop)) g.CopyFromScreen(area.Location, Point.Empty, area.Size);
                    using (Selection select = new Selection(desktop, area)) {
                        if (select.ShowDialog() == DialogResult.OK) {
                            Bitmap next = desktop.Clone(select.Selected, PixelFormat.Format32bppArgb);
                            preview.Image = next; if (image != null) image.Dispose(); image = next;
                            status.Text = "已截图 · " + next.Width + " × " + next.Height;
                        } else status.Text = "已取消截图，原来的内容已保留。";
                    }
                }
            } catch (Exception) { status.Text = "截图失败，请重试；远程桌面或受保护内容可能无法截图。"; }
            finally { selecting = false; Show(); Activate(); question.Focus(); }
        };
        delay.Start();
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
