// Ghidra headless script: writes the disassembly of the functions given as arguments
// (entry addresses) to <outdir>/asm_<addr>.txt.
//   analyzeHeadless <proj> <name> -process <exe> -noanalysis -postScript ExportAsm.java <outdir> <addr>...
// @category Export
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

public class ExportAsm extends GhidraScript {
  @Override
  public void run() throws Exception {
    String[] args = getScriptArgs();
    for (int i = 1; i < args.length; i++) {
      Address a = toAddr(args[i]);
      Function f = getFunctionAt(a);
      if (f == null) { println("no function at " + args[i]); continue; }
      try (PrintWriter out = new PrintWriter(new FileWriter(new File(args[0], "asm_" + args[i] + ".txt")))) {
        InstructionIterator it = currentProgram.getListing().getInstructions(f.getBody(), true);
        while (it.hasNext()) {
          Instruction ins = it.next();
          out.println(ins.getAddress() + "  " + ins.toString());
        }
      }
    }
  }
}
