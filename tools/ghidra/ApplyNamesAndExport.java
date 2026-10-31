// Ghidra headless post-script: applies the function names/comments of names.tsv, the structures of bi3_types.h
// and the global names of globals.tsv to SDI_1C.EXE, then writes the decompiled C grouped by original source file.
//   analyzeHeadless <proj> bi3 -process SDI_1C.EXE -noanalysis -postScript ApplyNamesAndExport.java <workdir> <outdir>
// names.tsv: addr  name  module  status  comment     globals.tsv: addr  name  type  comment
// @category Export
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.app.util.cparser.C.CParser;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.SourceType;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class ApplyNamesAndExport extends GhidraScript {
  static class Entry { long addr; String name, module, status, comment; }

  @Override
  public void run() throws Exception {
    String work = getScriptArgs()[0], outDir = getScriptArgs()[1];
    new File(outDir).mkdirs();

    // structures
    DataTypeManager dtm = currentProgram.getDataTypeManager();
    String header = "#pragma pack(1)\n" + Files.readString(Paths.get(work, "bi3_types.h"), StandardCharsets.UTF_8);
    CParser parser = new CParser(dtm, true, null);
    parser.parse(header);
    Map<String, DataType> types = new HashMap<>();
    for (String t : new String[] {"UNIT", "UNITCLASS", "SHOP", "TRANSPORTER", "PLAYERREC", "TERRAIN", "ACTION", "UNITNAME"}) {
      DataType dt = findType(dtm, t);
      if (dt != null) types.put(t, dt); else println("type not found: " + t);
    }

    // globals (an earlier run typed the terrain table too long: clear that range first)
    clearListing(toAddr(0x4bcb50L), toAddr(0x4bcb50L + 1335L * 0x2e - 1));
    for (String line : Files.readAllLines(Paths.get(work, "globals.tsv"), StandardCharsets.UTF_8)) {
      String[] c = line.split("\t");
      if (c.length < 4) continue;
      Address a = toAddr(Long.parseLong(c[0], 16));
      String typeText = c[2];
      int br = typeText.indexOf('[');
      String base = br < 0 ? typeText : typeText.substring(0, br);
      if (types.containsKey(base) && br > 0) {
        int n = Integer.parseInt(typeText.substring(br + 1, typeText.indexOf(']')));
        DataType dt = types.get(base);
        try {
          clearListing(a, a.add((long) n * dt.getLength() - 1));
          createData(a, new ArrayDataType(dt, n, dt.getLength()));
        } catch (Exception e) { println("could not type " + c[1] + ": " + e.getMessage()); }
      }
      try { createLabel(a, c[1], true, SourceType.USER_DEFINED); } catch (Exception e) { println("label " + c[1] + ": " + e.getMessage()); }
      setPlateComment(a, c[1] + " (" + typeText + "): " + c[3]);
    }

    // functions
    List<Entry> entries = new ArrayList<>();
    Map<String, String> byAddr = new HashMap<>();
    Set<String> used = new HashSet<>();
    for (String line : Files.readAllLines(Paths.get(work, "names.tsv"), StandardCharsets.UTF_8)) {
      String[] c = line.split("\t", 5);
      if (c.length < 5 || c[0].isEmpty()) continue;
      Entry e = new Entry();
      e.addr = Long.parseLong(c[0], 16);
      String n = c[1].replaceAll("[^A-Za-z0-9_]", "_");
      String unique = n;
      for (int k = 2; used.contains(unique); k++) unique = n + "_" + k;
      used.add(unique);
      e.name = unique; e.module = c[2]; e.status = c[3]; e.comment = c[4];
      entries.add(e);
      byAddr.put(String.format("%08x", e.addr), e.name);
    }
    for (Entry e : entries) {
      java.util.regex.Matcher mm = java.util.regex.Pattern.compile("FUN_([0-9a-f]{8})").matcher(e.comment);
      StringBuffer sb = new StringBuffer();
      while (mm.find()) mm.appendReplacement(sb, byAddr.getOrDefault(mm.group(1), mm.group(0)));
      mm.appendTail(sb);
      e.comment = sb.toString();
      Function f = getFunctionAt(toAddr(e.addr));
      if (f == null) { println("no function at " + String.format("%08x", e.addr)); continue; }
      try { f.setName(e.name, SourceType.USER_DEFINED); } catch (Exception ex) { println("rename " + e.name + ": " + ex.getMessage()); }
      f.setComment(e.comment);
    }

    // export, grouped by module in address order
    entries.sort(Comparator.comparingLong(x -> x.addr));
    Map<String, List<Entry>> byModule = new TreeMap<>();
    for (Entry e : entries) byModule.computeIfAbsent(e.module, k -> new ArrayList<>()).add(e);
    DecompInterface ifc = new DecompInterface();
    DecompileOptions opts = new DecompileOptions();
    ifc.setOptions(opts);
    ifc.openProgram(currentProgram);
    for (Map.Entry<String, List<Entry>> m : byModule.entrySet()) {
      try (PrintWriter out = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(outDir, m.getKey() + ".c")), StandardCharsets.UTF_8))) {
        out.println("/* " + m.getKey() + ".c - decompiled from SDI_1C.EXE (Battle Isle 3), " + m.getValue().size() + " functions.");
        out.println("   Names and comments: analysis of the browser port. Types: bi3_types.h. Not compilable as is. */");
        out.println("#include \"bi3_types.h\"");
        out.println();
        for (Entry e : m.getValue()) {
          if (monitor.isCancelled()) return;
          Function f = getFunctionAt(toAddr(e.addr));
          out.println("/* ---------------------------------------------------------------------------------------------");
          out.println("   " + e.name + "  @ " + String.format("%08x", e.addr) + "  (" + e.module + ")");
          String s = e.status;
          if (s.startsWith("GAME:") || s.startsWith("UI:")) out.println("   Browser: " + s.substring(s.indexOf(':') + 1));
          else if (s.startsWith("PART:")) out.println("   Browser: partly (" + s.substring(5) + ")");
          else if (s.startsWith("MISS:")) out.println("   Browser: missing (" + s.substring(5) + ")");
          out.println("   ------------------------------------------------------------------------------------------- */");
          if (f == null) { out.println("/* no function */\n"); continue; }
          DecompileResults r = ifc.decompileFunction(f, 120, monitor);
          if (r != null && r.decompileCompleted()) out.println(r.getDecompiledFunction().getC());
          else out.println("/* decompilation failed */\n");
        }
      }
      println("wrote " + m.getKey() + ".c");
    }
  }

  static DataType findType(DataTypeManager dtm, String name) {
    Iterator<DataType> it = dtm.getAllDataTypes();
    DataType best = null;
    while (it.hasNext()) {
      DataType d = it.next();
      if (d.getName().equals(name)) { if (d instanceof TypeDef) best = ((TypeDef) d).getBaseDataType(); else if (best == null) best = d; }
    }
    return best;
  }

  static List<String> wrap(String text, int width) {
    List<String> out = new ArrayList<>();
    StringBuilder line = new StringBuilder();
    for (String w : text.split(" ")) {
      if (line.length() + w.length() + 1 > width && line.length() > 0) { out.add(line.toString()); line.setLength(0); }
      if (line.length() > 0) line.append(' ');
      line.append(w.replace("*/", "* /"));
    }
    if (line.length() > 0) out.add(line.toString());
    return out;
  }
}
