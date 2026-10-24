// Ghidra headless post-script: writes the decompiled C of every function plus a string
// cross-reference listing next to the analysed program.
//   analyzeHeadless <proj> <name> -import <exe> -postScript ExportDecomp.java <outdir>
// @category Export
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.symbol.*;
import java.io.*;

public class ExportDecomp extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = getScriptArgs().length > 0 ? getScriptArgs()[0] : ".";
    String base = currentProgram.getName();
    DecompInterface ifc = new DecompInterface();
    ifc.openProgram(currentProgram);
    try (PrintWriter out = new PrintWriter(new FileWriter(new File(outDir, base + ".c")))) {
      FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
      int n = 0;
      while (it.hasNext() && !monitor.isCancelled()) {
        Function f = it.next();
        DecompileResults r = ifc.decompileFunction(f, 120, monitor);
        out.println("// ==== " + f.getName() + " @ " + f.getEntryPoint() + " ====");
        if (r != null && r.decompileCompleted()) out.println(r.getDecompiledFunction().getC());
        else out.println("// decompilation failed: " + (r == null ? "null" : r.getErrorMessage()));
        n++;
      }
      println("decompiled " + n + " functions");
    }
    try (PrintWriter out = new PrintWriter(new FileWriter(new File(outDir, base + ".strings.txt")))) {
      DataIterator di = currentProgram.getListing().getDefinedData(true);
      while (di.hasNext()) {
        Data d = di.next();
        if (!d.hasStringValue()) continue;
        StringBuilder refs = new StringBuilder();
        for (Reference ref : getReferencesTo(d.getAddress())) {
          Function f = getFunctionContaining(ref.getFromAddress());
          refs.append(' ').append(f == null ? ref.getFromAddress().toString() : f.getName() + "@" + ref.getFromAddress());
        }
        String v = String.valueOf(d.getValue()).replace("\n", "\\n").replace("\r", "\\r");
        out.println(d.getAddress() + "\t" + v + "\t" + refs);
      }
    }
  }
}
