package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import static io.github.dajiaohuang.solaratlas.OrbitPropagationReport.*;

/** Reconstructs descriptive summaries from checked draw records, not integrations. */
public final class OrbitEventTiming {
    public final String direction;
    public final int total,selected,failed,unresolved,notDetected,ambiguousZero;
    private final Quantile[] quantiles;
    public static final class Quantile {
        public final double fraction,elapsedTdbSeconds,lowerSeconds,upperSeconds;
        public final int rank;
        private Quantile(double fraction,int rank,double time,double lower,double upper){
            this.fraction=fraction;this.rank=rank;elapsedTdbSeconds=time;lowerSeconds=lower;upperSeconds=upper;
        }
    }
    private OrbitEventTiming(String direction,int[] counts,Quantile[] quantiles){
        this.direction=direction;total=counts[0];selected=counts[1];failed=counts[2];unresolved=counts[3];notDetected=counts[4];ambiguousZero=counts[5];this.quantiles=quantiles;
    }
    public Quantile[] quantiles(){return quantiles.clone();}

    static OrbitEventTiming[] bind(Object raw,String[] statuses,OrbitEventReport.Event[][] events) throws IOException {
        require(statuses.length>=1 && statuses.length<=128 && events.length==statuses.length,"Bounded timing draw identities required");
        Map<String,Object> root=object(raw);notes(root.get("limitations"));
        require("conditional-first-detected-nearest-rank-times-v1".equals(root.get("method")),"Event timing method mismatch");
        List<?> summaries=list(root.get("summaries"));require(summaries.size()==2,"Two timing directions required");
        OrbitEventTiming[] output=new OrbitEventTiming[2];String[] directions={"decreasing","increasing"};
        for(int d=0;d<2;d++) {
            check();String direction=directions[d];Map<String,Object> summary=object(summaries.get(d));
            require(direction.equals(summary.get("direction")) && "first-detected-in-chronological-order".equals(summary.get("eventSelection")),"Timing direction/selection mismatch");
            List<?> selections=list(summary.get("selections")),exclusions=list(summary.get("exclusions"));
            require(selections.size()+exclusions.size()==statuses.length,"Timing partition size mismatch");
            int[] counts={statuses.length,0,0,0,0,0};int selectionCursor=0,exclusionCursor=0;
            List<Double> times=new ArrayList<>(),lower=new ArrayList<>(),upper=new ArrayList<>();
            for(int index=0;index<statuses.length;index++) {
                check();String reason=null;int chosen=-1;double firstZero=Double.POSITIVE_INFINITY;
                if("failed".equals(statuses[index])){reason="failed";counts[2]++;}
                else if("unresolved".equals(statuses[index])){reason="unresolved";counts[3]++;}
                else {
                    require("searched".equals(statuses[index]),"Unknown timing draw status");
                    for(int j=0;j<events[index].length;j++) {
                        OrbitEventReport.Event event=events[index][j];
                        if("sampled-zero".equals(event.kind))firstZero=Math.min(firstZero,event.elapsedTdbSeconds);
                        else if(chosen<0 && "sign-change".equals(event.kind) && direction.equals(event.direction))chosen=j;
                    }
                    if(Double.isFinite(firstZero) && (chosen<0 || firstZero<=events[index][chosen].elapsedTdbSeconds)){reason="earlier-unclassified-zero";counts[5]++;}
                    else if(chosen<0){reason="not-detected";counts[4]++;}
                }
                if(reason!=null) {
                    require(exclusionCursor<exclusions.size(),"Missing timing exclusion");Map<String,Object> entry=object(exclusions.get(exclusionCursor++));
                    require(integer(entry.get("index"))==index && reason.equals(entry.get("reason")),"Timing exclusion identity mismatch");
                } else {
                    require(selectionCursor<selections.size(),"Missing timing selection");Map<String,Object> entry=object(selections.get(selectionCursor++));
                    OrbitEventReport.Event event=events[index][chosen];
                    require(integer(entry.get("index"))==index && integer(entry.get("eventIndex"))==chosen && number(entry.get("elapsedTdbSeconds"))==event.elapsedTdbSeconds &&
                        Arrays.equals(vector(entry.get("bracketSeconds"),2),new double[]{event.lowerSeconds,event.upperSeconds}),"Timing selection identity/value mismatch");
                    counts[1]++;times.add(event.elapsedTdbSeconds);lower.add(event.lowerSeconds);upper.add(event.upperSeconds);
                }
            }
            require(selectionCursor==selections.size() && exclusionCursor==exclusions.size(),"Unexpected timing identities");
            Map<String,Object> reportedCounts=object(summary.get("counts"));String[] names={"total","selected","failed","unresolved","notDetected","ambiguousZero"};
            for(int i=0;i<names.length;i++)require(integer(reportedCounts.get(names[i]))==counts[i],"Timing counts mismatch");
            Quantile[] quantiles;
            if(counts[1]<2) {
                require("insufficient-selected-draws".equals(summary.get("status")) && summary.get("quantiles")==null,"Unavailable timing must have null quantiles");quantiles=new Quantile[0];
            } else {
                require("available".equals(summary.get("status")),"Available timing status mismatch");
                times.sort(Double::compare);lower.sort(Double::compare);upper.sort(Double::compare);
                List<?> rows=list(summary.get("quantiles"));require(rows.size()==3,"Three nearest ranks required");quantiles=new Quantile[3];double[] fractions={.05,.5,.95};
                for(int i=0;i<3;i++) {
                    int rank=(int)Math.ceil(fractions[i]*counts[1]);Map<String,Object> row=object(rows.get(i));
                    require(number(row.get("fraction"))==fractions[i] && integer(row.get("rank"))==rank && number(row.get("elapsedTdbSeconds"))==times.get(rank-1) &&
                        Arrays.equals(vector(row.get("localizationBoundsSeconds"),2),new double[]{lower.get(rank-1),upper.get(rank-1)}),"Timing nearest-rank value/bounds mismatch");
                    quantiles[i]=new Quantile(fractions[i],rank,times.get(rank-1),lower.get(rank-1),upper.get(rank-1));
                }
            }
            output[d]=new OrbitEventTiming(direction,counts,quantiles);
        }
        check();return output;
    }
}
